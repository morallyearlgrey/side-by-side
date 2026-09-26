import { config } from './config';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; expectedUserId?: string; timeoutMs?: number } = {}): Promise<T> {
  if (!config.apiUrl) throw new ApiError('The connection service is not configured for this build yet.', 503);
  const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
  if (!data.session) throw new ApiError('Please sign in again to continue.', 401);
  if (options.expectedUserId && data.session.user.id !== options.expectedUserId) {
    throw new ApiError('Your account changed. Please try again.', 409, 'account_changed');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);
  if (options.signal?.aborted) controller.abort();
  try {
    const res = await fetch(`${config.apiUrl}${path}`, { method: options.method || 'GET', body: options.body === undefined ? undefined : JSON.stringify(options.body), headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, signal: controller.signal });
    const json = res.status === 204 ? undefined : await res.json();
    if (!res.ok) {
      const detail = json?.detail;
      throw new ApiError(json?.error?.message || (typeof detail === 'string' ? detail : detail?.message) || 'We could not complete that request. Please try again.', res.status, json?.error?.code || detail?.code);
    }
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e instanceof Error && e.name === 'AbortError' ? 'The request took too long. Please try again.' : 'The service is unreachable. Check your connection and try again.', 0);
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';
