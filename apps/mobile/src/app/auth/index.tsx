import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { Brand, Button, Field, Notice, Screen, s } from '@/components/ui';
import { SpaceCanvas } from '@/components/SpaceCanvas';
import { GlowPanel } from '@/components/GlowPanel';
import { GradientText } from '@/components/GradientText';
import { useLunar } from '@/components/Lunar';
import { supabase } from '@/lib/supabase';
import { authConfigured } from '@/lib/config';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';

export default function AuthScreen() {
  const { session, loading } = useAuth();
  const { reducedMotion } = useLunar();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'signup' | 'signin' | 'recover'>(params.mode === 'signup' || params.mode === 'recover' ? params.mode : 'signin');
  useEffect(() => { if (params.mode === 'signin' || params.mode === 'signup' || params.mode === 'recover') setMode(params.mode); }, [params.mode]);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [info, setInfo] = useState('');
  const [resending, setResending] = useState(false);
  async function resendConfirmation() {
    if (!supabase || busy || resending || !email.trim()) return;
    setResending(true); setError(''); setInfo('');
    try {
      const { error: e } = await supabase.auth.resend({ type: 'signup', email: email.trim(),
        options: { emailRedirectTo: Linking.createURL('auth/callback', { scheme: 'sidebyside' }) } });
      if (e) throw e;
      setInfo('If this account is awaiting confirmation, a new email has been requested. Check your inbox and spam folder, then open the newest link on this phone or in this browser.');
    } catch (e) { setError(errorMessage(e)); } finally { setResending(false); }
  }
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
  // Confirmation can finish in another tab. Follow the shared session instead
  // of leaving the original tab on a stale signup/confirmation notice.
  if (loading) return <Screen><Brand /><ActivityIndicator /></Screen>;
  if (session && mode !== 'recover' && params.mode !== 'recover') return <Redirect href="/" />;
  return <Screen style={{ maxWidth: 680, paddingBottom: 80, gap: 18 }}><Brand compact />
    <View style={{ alignItems: 'center', paddingTop: 12, gap: 12 }}><Text style={{ color: '#FCB187', letterSpacing: 2.5, fontSize: 10 }}>AN ORBIT CLOSER TO YOUR PEOPLE</Text><GradientText align="center" size={43}>{mode === 'signup' ? 'Your people. Closer than you think.' : mode === 'recover' ? 'Let’s get you back in.' : 'Hello again. Make room for connection.'}</GradientText><Text style={[s.subtitle, { textAlign: 'center', maxWidth: 430 }]}>Meet the people around you through the things that make you, you.</Text></View>
    <View style={{ height: 130, overflow: 'hidden', marginTop: -8, marginBottom: -12 }}><SpaceCanvas scene="eclipse" height={270} reducedMotion={reducedMotion} /></View>
    <GlowPanel><View style={{ gap: 16 }}><Text style={{ color: '#FFE6DC', fontSize: 24, letterSpacing: -.5 }}>{mode === 'signup' ? 'Create your account' : mode === 'recover' ? 'Reset your password' : 'Welcome back'}</Text><Field label="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      {mode !== 'recover' && <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" />}
      {!authConfigured && <Notice>This build needs its account service connected before you can sign in.</Notice>}
      {!!error && <Notice error>{error}</Notice>}{!!info && <Notice>{info}</Notice>}
      <Button title={mode === 'signup' ? 'Find my people' : mode === 'recover' ? 'Send reset link' : 'Sign in'} icon="arrow-forward" onPress={() => void submit()} loading={busy} disabled={resending || !authConfigured || !email.trim() || (mode !== 'recover' && password.length < 8)} />
      {mode !== 'recover' && <Button title="Resend confirmation email" icon="mail-outline" variant="secondary" onPress={() => void resendConfirmation()} loading={resending} disabled={busy || !authConfigured || !email.trim()} />}
      <Button title={mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'} variant="quiet" onPress={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setInfo(''); }} />
      {mode === 'signin' && <Button title="Forgot password?" variant="quiet" onPress={() => setMode('recover')} />}
    </View></GlowPanel><Text style={[s.small, { textAlign: 'center' }]}>You choose what to share, who to meet, and when to be seen.</Text>
  </Screen>;
}
