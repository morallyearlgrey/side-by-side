import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Brand, Button, Notice, Screen } from '@/components/ui';
import { PageHero } from '@/components/PageHero';
import { MatchingConsent } from '@/features/connect/MatchingConsent';
import { useDiscovery } from '@/features/connect/DiscoveryProvider';
import { Core2Badges } from '@/features/badges/Core2Badges';
import { OptionalDevices } from '@/features/devices/OptionalDevices';
import { useMe } from '@/features/profile/useMe';
import { useBluetooth } from '@/features/bluetooth/BluetoothProvider';
import { api, errorMessage } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const [signingOut, setSigningOut] = useState(false);
  const me = useMe(); const client = useQueryClient(); const ble = useBluetooth(); const discovery = useDiscovery(); const [error, setError] = useState('');
  const owner = me.data?.profile.user_id;
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
  return <Screen style={{ maxWidth: 960 }}><Brand /><PageHero kind="settings" title="Settings" description="Set up your devices and manage your account." />
    {me.isPending && <ActivityIndicator />}{me.error && <><Notice error>{errorMessage(me.error)}</Notice><Button title="Try again" onPress={() => void me.refetch()} /></>}
    {onboarding === 'permissions' && <><MatchingConsent disabled={signingOut} /><Button title="Continue" icon="arrow-forward" disabled={!me.data || me.isFetching} onPress={() => router.replace('/onboarding/permissions')} /></>}
    {me.data?.profile.user_id && <Core2Badges key={me.data.profile.user_id} userId={me.data.profile.user_id} />}
    {me.data?.profile.user_id && <OptionalDevices key={`devices-${me.data.profile.user_id}`} userId={me.data.profile.user_id} signingOut={signingOut} />}
    {!!error && <Notice error>{error}</Notice>}<Button title="Sign out" variant="quiet" onPress={() => void signOut()} />
  </Screen>;
}
