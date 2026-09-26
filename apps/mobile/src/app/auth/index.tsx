import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { Brand, Button, Card, Field, Heading, Notice, Screen, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { authConfigured } from '@/lib/config';
import { colors } from '@/lib/theme';
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
        if (data.session) router.replace('/'); else setInfo('Check your email to confirm your account. Open the link on this phone, or in this same browser if you’re testing on the web. You can also return here and sign in after confirming.');
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e; router.replace('/');
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Screen><Brand />
    <LinearGradient colors={['#211830', '#503078', '#181020']} style={{ height: 205, borderRadius: 8, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
      {[156, 114, 76].map((size, i) => <View key={size} style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: i === 2 ? '#FFFFFF' : '#FFFFFF80', backgroundColor: i === 2 ? '#FFFFFF90' : 'transparent' }} />)}
      <Ionicons name="sparkles" size={30} color={colors.background} /><View style={{ position: 'absolute', bottom: 16, paddingVertical: 5, paddingHorizontal: 12, backgroundColor: colors.input, borderRadius: 20 }}><Text style={{ fontSize: 10, letterSpacing: 0, color: colors.violetDark }}>GOOD CONNECTIONS START CLOSE</Text></View>
    </LinearGradient>
    <Heading eyebrow="A little closer. A little more you." title={mode === 'signup' ? 'Your people.\nCloser than you think.' : mode === 'recover' ? 'Let’s get you\nback in.' : 'Hello again.\nMake room for connection.'} subtitle="Meet the people around you through the things that make you, you." />
    <Card><Field label="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      {mode !== 'recover' && <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" />}
      {!authConfigured && <Notice>This build needs its account service connected before you can sign in.</Notice>}
      {!!error && <Notice error>{error}</Notice>}{!!info && <Notice>{info}</Notice>}
      <Button title={mode === 'signup' ? 'Find my people' : mode === 'recover' ? 'Send reset link' : 'Sign in'} icon="arrow-forward" onPress={() => void submit()} loading={busy} disabled={!authConfigured || !email.trim() || (mode !== 'recover' && password.length < 8)} />
      <Button title={mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'} variant="quiet" onPress={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setInfo(''); }} />
      {mode === 'signin' && <Button title="Forgot password?" variant="quiet" onPress={() => setMode('recover')} />}
    </Card><Text style={[s.small, { textAlign: 'center' }]}>You choose what to share, who to meet, and when to be seen.</Text>
  </Screen>;
}
