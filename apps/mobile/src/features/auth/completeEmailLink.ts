type ExchangeResult = {
  data: { session: { user: { id: string } } | null; redirectType?: string | null };
  error: { code?: string; message: string } | null;
};
type Exchange = (code: string, options?: { flowId?: string }) => Promise<ExchangeResult>;

export type EmailLinkResult =
  | { status: 'ready'; recovery: boolean; userId: string }
  | { status: 'error'; title: string; message: string };

function failure(error?: { code?: string; message?: string }): EmailLinkResult {
  const missingVerifier = error?.code === 'pkce_code_verifier_not_found'
    || /code verifier|code_verifier/i.test(error?.message || '');
  return missingVerifier ? {
    status: 'error',
    title: 'Finish signing in.',
    message: 'Your email may already be confirmed. Sign in with the email and password you created. Automatic sign-in needs the same browser or app that requested the email. For a password reset, request a new reset link here.',
  } : {
    status: 'error',
    title: 'Let’s get you signed in.',
    message: 'This email link could not sign you in. It may have expired or already been used. Try your email and password, or request a new password reset link.',
  };
}

// Keep one exchange per code for this mounted callback, including React's
// development effect replay. Supabase consumes the verifier during exchange.
export function createEmailLinkCompleter(exchange: Exchange) {
  const attempts = new Map<string, Promise<EmailLinkResult>>();
  return (url: string): Promise<EmailLinkResult> => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return Promise.resolve(failure()); }
    const code = parsed.searchParams.get('code');
    if (!code || parsed.searchParams.has('error')) return Promise.resolve(failure());
    const flowId = parsed.searchParams.get('sb_flow_id') || undefined;
    const key = JSON.stringify([code, flowId]);
    const existing = attempts.get(key);
    if (existing) return existing;
    const attempt = (async (): Promise<EmailLinkResult> => {
      try {
        const { data, error } = await exchange(code, flowId ? { flowId } : undefined);
        if (error || !data.session) return failure(error ?? undefined);
        return { status: 'ready', recovery: data.redirectType === 'recovery', userId: data.session.user.id };
      } catch {
        return { status: 'error', title: 'We couldn’t connect.', message: 'Check your connection, then sign in or request a new email link.' };
      }
    })();
    attempts.set(key, attempt);
    if (attempts.size > 4) attempts.delete(attempts.keys().next().value!);
    return attempt;
  };
}
