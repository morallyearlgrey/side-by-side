import { config } from './config';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; expectedUserId?: string; timeoutMs?: number } = {}): Promise<T> {
  if (!config.apiUrl) throw new ApiError('The connection service is not configured for this build yet.', 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
  const abort = () => controller.abort();
  const interrupted = new ApiError('The request took too long or was cancelled. Please try again.', 0);
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(interrupted);
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  options.signal?.addEventListener('abort', abort);
  if (options.signal?.aborted) controller.abort();
  try {
    // The deadline covers auth refresh and response parsing too. A stuck auth
    // lookup must not leave a location action (or any other screen) spinning.
    return await Promise.race([aborted, (async () => {
      if (controller.signal.aborted) throw interrupted;
      const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
      // A timed-out lookup may resolve later; never send its deferred mutation.
      if (controller.signal.aborted) throw interrupted;
      if (!data.session) throw new ApiError('Please sign in again to continue.', 401);
      if (options.expectedUserId && data.session.user.id !== options.expectedUserId) {
        throw new ApiError('Your account changed. Please try again.', 409, 'account_changed');
      }
      const res = await fetch(`${config.apiUrl}${path}`, { method: options.method || 'GET', body: options.body === undefined ? undefined : JSON.stringify(options.body), headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, signal: controller.signal });
      let json;
      if (res.status !== 204) {
        try { json = await res.json(); }
        catch {
          if (controller.signal.aborted) throw interrupted;
          // Proxies and unhandled server errors can return plain text or HTML.
          // Keep the HTTP status so these are not reported as network failures.
          throw new ApiError(res.ok
            ? 'The server returned an unexpected response. Please try again.'
            : 'The server could not complete this request. Please try again.',
          res.status, res.ok ? 'invalid_response' : 'server_response_error');
        }
      }
      if (!res.ok) {
        const detail = json?.detail;
        throw new ApiError(json?.error?.message || (typeof detail === 'string' ? detail : detail?.message) || 'We could not complete that request. Please try again.', res.status, json?.error?.code || detail?.code);
      }
      if (options.expectedUserId) {
        const latest = await supabase?.auth.getSession();
        if (latest?.data.session?.user.id !== options.expectedUserId) {
          throw new ApiError('Your account changed. Please try again.', 409, 'account_changed');
        }
      }
      if (controller.signal.aborted) throw interrupted;
      return json as T;
    })()]);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e instanceof Error && e.name === 'AbortError' ? 'The request took too long. Please try again.' : 'The service is unreachable. Check your connection and try again.', 0);
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAbort); }
}
export const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';
