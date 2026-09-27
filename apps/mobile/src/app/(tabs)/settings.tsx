import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Brand, Button, Section, Notice, Screen, Toggle } from '@/components/ui';
import { PageHero } from '@/components/PageHero';
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
  return <Screen><Brand /><PageHero kind="settings" title="Settings" description="Your discovery, sharing and account choices, always in your hands." />
    {me.isPending && <ActivityIndicator />}{me.error && <><Notice error>{errorMessage(me.error)}</Notice><Button title="Try again" onPress={() => void me.refetch()} /></>}
    <Toggle title="Use my approved details for matching" description="Allow personal matching with your approved details. This does not enable discovery, optional devices or shared-model training." value={!!me.data?.matching_consent} disabled={!me.data || me.isError || consent.isPending || signingOut} onValueChange={granted => consent.mutate(granted)} />
    {consent.error && <Notice error>{errorMessage(consent.error)}</Notice>}
    {onboarding === 'permissions' && <Button title="Continue" icon="arrow-forward" disabled={!me.data || consent.isPending} onPress={() => router.replace('/onboarding/permissions')} />}
    <Section title="Discovery"><DiscoveryControls /></Section>
    {me.data && <PreviewSettings key={JSON.stringify(me.data.preview)} preview={me.data.preview} userId={me.data.profile.user_id} />}
    {me.data?.profile.user_id && <Core2Badges key={me.data.profile.user_id} userId={me.data.profile.user_id} />}
    {me.data?.profile.user_id && <OptionalDevices key={`devices-${me.data.profile.user_id}`} userId={me.data.profile.user_id} signingOut={signingOut} />}
    {!!error && <Notice error>{error}</Notice>}<Button title="Sign out" variant="quiet" onPress={() => void signOut()} />
  </Screen>;
}
