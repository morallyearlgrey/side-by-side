import { useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Brand, Button, Field, Heading, Notice, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/api';
import { createEmailLinkCompleter, type EmailLinkResult } from '@/features/auth/completeEmailLink';
import { useAuth } from '@/features/auth/AuthProvider';
export default function AuthCallback() {
  const url = Linking.useLinkingURL();
  const { session } = useAuth();
  const [result, setResult] = useState<EmailLinkResult | null>(null);
  const [error, setError] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const complete = useRef(createEmailLinkCompleter((code, options) => supabase!.auth.exchangeCodeForSession(code, options)));
  useEffect(() => {
    if (!supabase) { setResult({ status: 'error', title: 'Account setup is needed.', message: 'This build needs its account service configured before you can sign in.' }); return; }
    if (!url) return;
    let active = true;
    setResult(null); setError('');
    void complete.current(url).then(next => { if (active) setResult(next); });
    return () => { active = false; };
  }, [url]);
  async function save() {
    if (!supabase || result?.status !== 'ready' || !result.recovery) return;
    setBusy(true); setError('');
    try {
      const current = await supabase.auth.getSession();
      if (current.error) throw current.error;
      if (current.data.session?.user.id !== result.userId) throw new Error('Your account changed. Please request a new password reset link.');
      const { error: e } = await supabase.auth.updateUser({ password });
      if (e) throw e; router.replace('/');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const accountChanged = result?.status === 'ready' && session?.user.id !== result.userId;
  const ready = result?.status === 'ready' && !accountChanged;
  const recovery = ready && result.recovery;
  return <Screen><Brand /><Heading title={accountChanged ? 'Your account changed.' : result?.status === 'error' ? result.title : ready ? recovery ? 'Choose a new password.' : 'You’re signed in.' : 'Opening your account…'} subtitle={ready ? recovery ? 'Use at least 8 characters for your new password.' : 'Continue to tell us what makes you, you.' : result ? undefined : 'Checking your email link…'} />
    {accountChanged && <Notice>Return to sign in. For a password reset, request a new link for the account you want to update.</Notice>}
    {result?.status === 'error' && <Notice>{result.message}</Notice>}
    {!!error && <Notice error>{error}</Notice>}
    {ready && (recovery ? <><Field label="New password" secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} /><Button title="Update password" loading={busy} disabled={password.length < 8} onPress={() => void save()} /></> : <Button title="Continue" onPress={() => router.replace('/')} />)}
    <Button variant={ready ? 'quiet' : 'primary'} title="Back to sign in" onPress={() => router.replace({ pathname: '/auth', params: { mode: 'signin' } })} />
    {(result?.status === 'error' || accountChanged) && <Button variant="quiet" title="Request a new password reset link" onPress={() => router.replace({ pathname: '/auth', params: { mode: 'recover' } })} />}
  </Screen>;
}
