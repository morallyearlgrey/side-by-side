import { useCallback, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Brand, Button, Card, Chips, EmptyState, Heading, Notice, Screen, s } from '@/components/ui';
import { useDiscovery } from '@/features/connect/DiscoveryProvider';
import { DiscoveryControls } from '@/features/connect/DiscoveryControls';
import { MatchDescription } from '@/features/connect/MatchDescription';
import { discoveryTarget } from '@/features/connect/MatchNotifications';

export default function Connect() {
  const discovery = useDiscovery();
  const [focused, setFocused] = useState(false);
  const locationOn = !!discovery?.presence.enabled;
  const bluetoothOn = !!discovery?.ble.state.live;
  const discoveryOn = locationOn || bluetoothOn;
  const emptyTitle = !discoveryOn ? 'Discovery is off.'
    : discovery?.error ? 'Discovery needs attention.'
    : discovery?.modelUnavailable ? 'Matching is temporarily unavailable.'
    : discovery?.pending ? 'Checking nearby matches…' : 'No eligible people nearby yet.';
  const emptyMessage = !discoveryOn ? 'Turn on location or Bluetooth above to find nearby SidebySide users.'
    : discovery?.error ? 'Check the message above, then refresh discoveries.'
    : discovery?.modelUnavailable ? 'Your device can keep discovering nearby signals. People appear here once the matching service can check their approved profiles.'
    : discovery?.pending ? 'Nearby profiles are being checked. Results update automatically.'
    : 'Other people need SidebySide discovery and preview sharing enabled. Keep the app open; nearby results update automatically.';
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  return <Screen><Brand /><Heading title="Connect" subtitle="People you might enjoy a conversation with." />
    <View style={{ gap: 16 }}><DiscoveryControls /></View>
    <View style={{ gap: 16 }} accessibilityLabel="Location and Bluetooth discoveries">
      <Text style={s.cardTitle}>Discoveries</Text>
      {!!discovery?.error && <Notice error>{discovery.error}</Notice>}
      {discovery?.modelUnavailable && <Notice>The matching service is unavailable. Location and Bluetooth can stay on while the service is restored.</Notice>}
      {!!discovery?.pending && <Notice>Checking approved conversation matches.</Notice>}
      {discovery?.busy && <ActivityIndicator />}
      {discovery?.items.map(item => <Card key={item.event_key} title={item.preview.display_name}>
        <Chips values={item.preview.interests} />
        <Body muted>{item.sources.map(source => source === 'ble' ? 'Bluetooth' : 'Location').join(' and ')} suggestion</Body>
        {focused && <MatchDescription target={discoveryTarget(item)} preview={item.preview} />}
        <Button title="View match" icon="chatbubble-outline" variant="secondary" onPress={() => discovery.open(item.event_key)} />
      </Card>)}
      {!discovery?.items.length && !discovery?.busy && <EmptyState title={emptyTitle} message={emptyMessage} />}
      <Button title="Refresh discoveries" icon="refresh-outline" variant="quiet" disabled={!discovery || (!discovery.presence.enabled && !discovery.ble.state.live)} onPress={() => void discovery?.refresh()} />
    </View>
  </Screen>;
}
