import { useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Body, Brand, Button, Card, Heading, Label, Notice, Screen, s } from '@/components/ui';
import { ProfileForm } from '@/features/profile/ProfileForm';
import { ReadinessChecklist } from '@/features/profile/ReadinessChecklist';
import { Core2Badges } from '@/features/badges/Core2Badges';
import { useMe } from '@/features/profile/useMe';
import { useBluetooth } from '@/features/bluetooth/BluetoothProvider';
import { api, errorMessage } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { ReviewRequest } from '@/lib/types';

type SpotifyStatus = { available: boolean; reason?: string; connected: boolean; display?: { display_name?: string; [key: string]: unknown }; matching_supported: false };
export default function Settings() {
  const me = useMe(); const client = useQueryClient(); const ble = useBluetooth(); const [saved, setSaved] = useState(false); const [error, setError] = useState('');
  const spotify = useQuery({ queryKey: ['spotify'], queryFn: () => api<SpotifyStatus>('/v1/integrations/spotify') });
  const save = useMutation({ mutationFn: async (body: ReviewRequest) => { if (!body.matching_consent) await ble.stop(); return api('/v1/profile', { method: 'PATCH', body }); }, onSuccess: async () => { setSaved(true); await client.invalidateQueries({ queryKey: ['me'] }); client.removeQueries({ queryKey: ['nearby'] }); await client.invalidateQueries({ queryKey: ['connections'] }); } });
  const pause = useMutation({ mutationFn: () => api('/v1/settings', { method: 'PATCH', body: { discoverable: false } }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['me'] }); client.removeQueries({ queryKey: ['nearby'] }); } });
  const music = useMutation({ mutationFn: async () => {
    if (spotify.data?.connected) { await api('/v1/integrations/spotify', { method: 'DELETE' }); return; }
    const result = await api<{ authorization_url: string }>('/v1/integrations/spotify/connect', { method: 'POST' });
    await WebBrowser.openAuthSessionAsync(result.authorization_url, 'sidebyside://settings');
  }, onSuccess: () => void client.invalidateQueries({ queryKey: ['spotify'] }) });
  async function signOut() {
    setError('');
    try {
      await ble.stop();
      try { await api('/v1/settings', { method: 'PATCH', body: { discoverable: false, bluetooth_enabled: false } }); } catch { /* Presence and server tokens still expire; local sign-out must remain available. */ }
      const result = await supabase?.auth.signOut({ scope: 'local' }); if (result?.error) throw result.error; client.clear(); router.replace('/auth');
    } catch (e) { setError(errorMessage(e)); }
  }
  return <Screen><Brand /><Heading eyebrow="Always a work in progress" title={"A little\nmore you."} subtitle="Your details, your preferences, your way of connecting." />
    {me.isPending && <ActivityIndicator />}{me.error && <><Notice error>{errorMessage(me.error)}</Notice><Button title="Try again" onPress={() => void me.refetch()} /></>}
    {me.data && <ReadinessChecklist me={me.data} settings />}
    <Card><Label>How you’re discovered</Label><Body muted>{me.data?.profile.discoverable ? 'Nearby is on while your location is fresh.' : 'Nearby discovery is paused.'}</Body>{me.data?.profile.discoverable ? <Button title="Pause Nearby discovery" variant="secondary" loading={pause.isPending} onPress={() => pause.mutate()} /> : <Button title="Set up Nearby" variant="secondary" onPress={() => router.push('/(tabs)')} />}<Button title={ble.state.live ? 'Turn Bluetooth Live off' : 'Open Bluetooth controls'} variant="quiet" onPress={() => { if (ble.state.live) void ble.stop(); else router.push('/(tabs)/bluetooth'); }} />{pause.error && <Notice error>{errorMessage(pause.error)}</Notice>}</Card>
    <Card><Text style={s.eyebrow}>Make it personal</Text><Text style={s.cardTitle}>A little music, a little you.</Text><Body muted>Connect Spotify to view your account. Your Spotify data is kept out of personality inference and AI matching.</Body>{spotify.data?.connected && <Notice>Connected{spotify.data.display?.display_name ? ` as ${spotify.data.display.display_name}` : ''}.</Notice>}{spotify.data && !spotify.data.available && <Notice>Spotify connection is not configured for this build yet.</Notice>}{(spotify.error || music.error) && <Notice error>{errorMessage(spotify.error || music.error)}</Notice>}<Button title={spotify.data?.connected ? 'Disconnect Spotify' : 'Connect Spotify'} variant="secondary" icon="musical-notes-outline" loading={music.isPending} disabled={!spotify.data?.available && !spotify.data?.connected} onPress={() => music.mutate()} /><Text style={s.small}>Instagram imports are coming later. Nothing is pulled from your accounts automatically.</Text></Card>
    {me.data?.profile.user_id && <Core2Badges key={me.data.profile.user_id} userId={me.data.profile.user_id} />}
    {saved && <Notice>Your profile has been saved. We’ll refresh matches using your updated details.</Notice>}
    {me.data?.current_version && <ProfileForm key={me.data.current_version.profile_version_id} initialDraft={me.data.current_version} initialSettings={{ ...me.data.profile.settings, discoverable: me.data.profile.discoverable, bluetooth_enabled: !!me.data.profile.bluetooth_enabled }} initialPreview={me.data.preview} initialConsent={me.data.matching_consent} saving={save.isPending} onSave={body => { setSaved(false); save.mutate(body); }} error={save.error ? errorMessage(save.error) : undefined} />}
    {!!error && <Notice error>{error}</Notice>}<Button title="Sign out" variant="quiet" onPress={() => void signOut()} />
  </Screen>;
}
