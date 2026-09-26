import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { Brand, Button, Section, Field, Heading, Notice, Screen, s } from '@/components/ui';
import { LunarArtwork } from '@/components/Lunar';
import { supabase } from '@/lib/supabase';
import { authConfigured } from '@/lib/config';
import { errorMessage } from '@/lib/api';

export default function AuthScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'signup' | 'signin' | 'recover'>(params.mode === 'signin' || params.mode === 'recover' ? params.mode : 'signup');
  useEffect(() => { if (params.mode === 'signin' || params.mode === 'recover') setMode(params.mode); }, [params.mode]);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [info, setInfo] = useState('');
  async function submit() {
    if (!supabase) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const redirectTo = Linking.createURL('auth/callback', { scheme: 'sidebyside' });
      if (mode === 'recover') {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (e) throw e; setInfo('Check your email for a password reset link. Open it on this phone, or in this same browser if you’re testing on the web.');
      } else if (mode === 'signup') {
        const { data, error: e } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo } });
        if (e) throw e;
        // Supabase can also return no session for an existing confirmed account.
        // Keep this notice generic; a successful response does not prove email delivery.
        if (data.session) router.replace('/'); else setInfo('If your account needs confirmation, check your inbox and spam folder. Open the link on this phone, or in this same browser on the web. Already registered? Choose Sign in below and use your original password.');
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e; router.replace('/');
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Screen><Brand />
    <LunarArtwork />
    <Heading eyebrow="A little closer. A little more you." title={mode === 'signup' ? 'Your people.\nCloser than you think.' : mode === 'recover' ? 'Let’s get you\nback in.' : 'Hello again.\nMake room for connection.'} subtitle="Meet the people around you through the things that make you, you." />
    <Section><Field label="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      {mode !== 'recover' && <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" />}
      {!authConfigured && <Notice>This build needs its account service connected before you can sign in.</Notice>}
      {!!error && <Notice error>{error}</Notice>}{!!info && <Notice>{info}</Notice>}
      <Button title={mode === 'signup' ? 'Find my people' : mode === 'recover' ? 'Send reset link' : 'Sign in'} icon="arrow-forward" onPress={() => void submit()} loading={busy} disabled={!authConfigured || !email.trim() || (mode !== 'recover' && password.length < 8)} />
      <Button title={mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'} variant="quiet" onPress={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setInfo(''); }} />
      {mode === 'signin' && <Button title="Forgot password?" variant="quiet" onPress={() => setMode('recover')} />}
    </Section><Text style={[s.small, { textAlign: 'center' }]}>You choose what to share, who to meet, and when to be seen.</Text>
  </Screen>;
}
