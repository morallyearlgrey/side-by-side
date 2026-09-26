import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Body, Brand, Button, Card, Heading, Notice, Screen } from '@/components/ui';
import { usePresence } from '@/features/nearby/usePresence';
import { useBluetooth } from '@/features/bluetooth/BluetoothProvider';
import { colors } from '@/lib/theme';
import { useMe } from '@/features/profile/useMe';
import { matchingReadiness } from '@/features/profile/matchingReadiness';
export default function Permissions() {
  const location = usePresence(); const ble = useBluetooth();
  const me = useMe();
  const profileReady = !!me.data && matchingReadiness(me.data.current_version, me.data.profile.settings, me.data.preview, !!me.data.matching_consent).ready;
  const canEnableLocation = !!me.data?.current_version && !!me.data?.matching_consent;
  return <Screen><Brand /><Heading eyebrow="Connection on your terms" title={"Make room\nfor a hello."} subtitle="Choose how you’d like to find people. You can change either option anytime." />
    {me.data && !me.data.matching_consent && <Button title="Matching consent settings" icon="options-outline" variant="quiet" onPress={() => router.replace({ pathname: '/(tabs)/settings', params: { onboarding: 'permissions' } })} />}
    <Card><Ionicons name="navigate-outline" size={28} color={colors.violet} /><Body>Find people within two miles while you use the app. Your precise location stays private.</Body>{location.stage !== 'idle' && <Body muted>{location.stage === 'locating' ? 'Finding your location… (up to 25 seconds)' : 'Saving your location…'}</Body>}{!!location.error && <Notice error>{location.error}</Notice>}<Button title={location.error ? 'Retry location' : location.enabled && location.lastUpdated ? 'Nearby is enabled' : 'Enable Nearby'} disabled={(!location.error && location.enabled && !!location.lastUpdated) || !canEnableLocation} loading={location.busy} onPress={() => void location.enable()} /></Card>
    <Card><Ionicons name="bluetooth" size={28} color={colors.violet} /><Body>Go Live to discover other SidebySide phones around you. Keep both apps open for this first version.</Body>{!!ble.error && <Notice error>{ble.error}</Notice>}<Button title={ble.state.live ? 'Bluetooth is Live' : 'Turn Bluetooth Live on'} disabled={ble.state.live || !profileReady} loading={ble.busy} onPress={() => void ble.start()} variant="secondary" /></Card>
    <Button title="Take me to SidebySide" onPress={() => router.replace('/(tabs)')} icon="arrow-forward" /><Body muted>These choices are optional. Your account works with discovery turned off.</Body>
  </Screen>;
}
