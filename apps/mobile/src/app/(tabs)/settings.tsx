import { useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Body, Brand, Button, Card, Heading, Label, Notice, Screen, Toggle, s } from '@/components/ui';
import { DiscoveryControls } from '@/features/connect/DiscoveryControls';
import { useDiscovery } from '@/features/connect/DiscoveryProvider';
import { PreviewSettings } from '@/features/profile/PreviewSettings';
import { Core2Badges } from '@/features/badges/Core2Badges';
import { OptionalDevices } from '@/features/devices/OptionalDevices';
import { useMe } from '@/features/profile/useMe';
import { useBluetooth } from '@/features/bluetooth/BluetoothProvider';
import { api, errorMessage } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { Me } from '@/lib/types';

type SpotifyStatus = { available: boolean; reason?: string; connected: boolean; display?: { display_name?: string; [key: string]: unknown }; matching_supported: false };
export default function Settings() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const [signingOut, setSigningOut] = useState(false);
  const me = useMe(); const client = useQueryClient(); const ble = useBluetooth(); const discovery = useDiscovery(); const [error, setError] = useState('');
  const owner = me.data?.profile.user_id;
  const consent = useMutation({ mutationFn: (granted: boolean) => api<{ granted: boolean }>('/v1/consents', { method: 'POST', expectedUserId: owner, body: { purpose: 'personal_matching', granted } }),
    onMutate: async () => {
      discovery?.hide();
      await client.cancelQueries({ queryKey: ['connections'] });
      client.removeQueries({ queryKey: ['connections'] });
      client.removeQueries({ queryKey: ['descriptions'] });
    }, onSuccess: async ({ granted }) => {
      await client.cancelQueries({ queryKey: ['me', owner] });
      client.setQueryData<Me>(['me', owner], current => current ? { ...current, matching_consent: granted,
        profile: granted ? current.profile : { ...current.profile, discoverable: false, bluetooth_enabled: false } } : current);
      if (!granted) await ble.stop();
    }, onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['me', owner] });
      await client.invalidateQueries({ queryKey: ['connections'] });
      await client.invalidateQueries({ queryKey: ['discoveries'] });
    } });
  const spotify = useQuery({ queryKey: ['spotify', me.data?.profile.user_id], queryFn: () => api<SpotifyStatus>('/v1/integrations/spotify', { expectedUserId: me.data?.profile.user_id }) });
  const describe = useMutation({ mutationFn: (enabled: boolean) => api('/v1/settings', { method: 'PATCH', expectedUserId: me.data?.profile.user_id, body: { muse_descriptions_enabled: enabled } }), onMutate: () => discovery?.hide(), onSuccess: async () => {
    client.removeQueries({ queryKey: ['descriptions'] }); await client.invalidateQueries({ queryKey: ['me'] });
  } });
  const music = useMutation({ mutationFn: async () => {
    if (spotify.data?.connected) { await api('/v1/integrations/spotify', { method: 'DELETE' }); return; }
    const result = await api<{ authorization_url: string }>('/v1/integrations/spotify/connect', { method: 'POST' });
    await WebBrowser.openAuthSessionAsync(result.authorization_url, 'sidebyside://settings');
  }, onSuccess: () => void client.invalidateQueries({ queryKey: ['spotify'] }) });
  async function signOut() {
    setError('');
    setSigningOut(true);
    discovery?.hide();
    try {
      await ble.stop();
      try { await api('/v1/devices/signout', { method: 'POST', expectedUserId: owner, timeoutMs: 5_000 }); } catch { /* Headset authorization also expires when its owner lease is not renewed. */ }
      try { await api('/v1/settings', { method: 'PATCH', body: { discoverable: false, bluetooth_enabled: false } }); } catch { /* Presence and server tokens still expire; local sign-out must remain available. */ }
      const result = await supabase?.auth.signOut({ scope: 'local' }); if (result?.error) throw result.error; client.clear(); router.replace('/auth');
    } catch (e) { setError(errorMessage(e)); setSigningOut(false); }
  }
  return <Screen><Brand /><Heading title="Settings" subtitle="Your discovery, sharing and account choices." />
    {me.isPending && <ActivityIndicator />}{me.error && <><Notice error>{errorMessage(me.error)}</Notice><Button title="Try again" onPress={() => void me.refetch()} /></>}
    <Toggle title="Use my approved details for matching" description="Allow personal matching with your approved details. This does not enable discovery, optional devices or shared-model training." value={!!me.data?.matching_consent} disabled={!me.data || me.isError || consent.isPending || signingOut} onValueChange={granted => consent.mutate(granted)} />
    {consent.error && <Notice error>{errorMessage(consent.error)}</Notice>}
    {onboarding === 'permissions' && <Button title="Continue" icon="arrow-forward" disabled={!me.data || consent.isPending} onPress={() => router.replace('/onboarding/permissions')} />}
    <Label>Discovery</Label><DiscoveryControls />
    {me.data && <PreviewSettings key={JSON.stringify(me.data.preview)} preview={me.data.preview} userId={me.data.profile.user_id} />}
    <Toggle title="Allow Muse match descriptions" description="Allow Muse to use your approved preview topics for in-app descriptions. Both people must allow this. This does not enable location sharing or headset display." value={!!me.data?.profile.settings.muse_descriptions_enabled} disabled={describe.isPending} onValueChange={enabled => describe.mutate(enabled)} />
    {describe.error && <Notice error>{errorMessage(describe.error)}</Notice>}
    <Card><Text style={s.eyebrow}>Make it personal</Text><Text style={s.cardTitle}>A little music, a little you.</Text><Body muted>Connect Spotify to view your account. Your Spotify data is kept out of personality inference and AI matching.</Body>{spotify.data?.connected && <Notice>Connected{spotify.data.display?.display_name ? ` as ${spotify.data.display.display_name}` : ''}.</Notice>}{spotify.data && !spotify.data.available && <Notice>Spotify connection is not configured for this build yet.</Notice>}{(spotify.error || music.error) && <Notice error>{errorMessage(spotify.error || music.error)}</Notice>}<Button title={spotify.data?.connected ? 'Disconnect Spotify' : 'Connect Spotify'} variant="secondary" icon="musical-notes-outline" loading={music.isPending} disabled={!spotify.data?.available && !spotify.data?.connected} onPress={() => music.mutate()} /><Text style={s.small}>Instagram imports are coming later. Nothing is pulled from your accounts automatically.</Text></Card>
    {me.data?.profile.user_id && <Core2Badges key={me.data.profile.user_id} userId={me.data.profile.user_id} />}
    {me.data?.profile.user_id && <OptionalDevices key={`devices-${me.data.profile.user_id}`} userId={me.data.profile.user_id} signingOut={signingOut} />}
    {!!error && <Notice error>{error}</Notice>}<Button title="Sign out" variant="quiet" onPress={() => void signOut()} />
  </Screen>;
}
