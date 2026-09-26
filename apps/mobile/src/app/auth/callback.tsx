import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Brand, Button, Field, Heading, Notice, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/api';
export default function AuthCallback() {
  const url = Linking.useURL(); const [error, setError] = useState(''); const [ready, setReady] = useState(false); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!url || !supabase) return;
    const parsed = new URL(url); const code = parsed.searchParams.get('code');
    if (!code) { setError('This link is incomplete. Please request a new email link.'); return; }
    void supabase.auth.exchangeCodeForSession(code).then(({ error: e }) => { if (e) setError(e.message); else setReady(true); });
  }, [url]);
  async function save() {
    if (!supabase) return; setBusy(true); setError('');
    try { const { error: e } = await supabase.auth.updateUser({ password }); if (e) throw e; router.replace('/'); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Screen><Brand /><Heading title={ready ? 'You’re back.' : 'Opening your account…'} subtitle="Continue to SidebySide, or set a new password if you requested a reset." />{!!error && <Notice error>{error}</Notice>}{ready && <><Button title="Continue" onPress={() => router.replace('/')} /><Field label="New password" secureTextEntry value={password} onChangeText={setPassword} /><Button title="Update password" loading={busy} disabled={password.length < 8} onPress={() => void save()} /></>}<Button variant="quiet" title="Back to sign in" onPress={() => router.replace('/auth')} /></Screen>;
}
