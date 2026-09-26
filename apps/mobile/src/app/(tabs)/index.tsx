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
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  return <Screen><Brand /><Heading title="Connect" subtitle="People you might enjoy a conversation with." />
    <View style={{ gap: 16 }}><DiscoveryControls /></View>
    <View style={{ gap: 16 }} accessibilityLabel="Location and Bluetooth discoveries">
      <Text style={s.cardTitle}>Discoveries</Text>
      {!!discovery?.error && <Notice error>{discovery.error}</Notice>}
      {discovery?.modelUnavailable && <Notice>Matching is currently unavailable. No radio signal alone is shown as an AI match.</Notice>}
      {!!discovery?.pending && <Notice>Checking approved conversation matches.</Notice>}
      {discovery?.busy && <ActivityIndicator />}
      {discovery?.items.map(item => <Card key={item.event_key} title={item.preview.display_name}>
        <Chips values={item.preview.interests} />
        <Body muted>{item.sources.map(source => source === 'ble' ? 'Bluetooth' : 'Location').join(' and ')} suggestion</Body>
        {focused && <MatchDescription target={discoveryTarget(item)} preview={item.preview} />}
        <Button title="View match" icon="chatbubble-outline" variant="secondary" onPress={() => discovery.open(item.event_key)} />
      </Card>)}
      {!discovery?.items.length && !discovery?.busy && <EmptyState title="No new discoveries." message="New eligible suggestions appear here briefly. Saved invitations and connections stay in Matches." />}
      <Button title="Refresh discoveries" icon="refresh-outline" variant="quiet" disabled={!discovery || (!discovery.presence.enabled && !discovery.ble.state.live)} onPress={() => void discovery?.refresh()} />
    </View>
  </Screen>;
}
