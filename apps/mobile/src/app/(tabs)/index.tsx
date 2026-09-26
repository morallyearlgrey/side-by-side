import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Brand, Button, Card, Chips, EmptyState, Heading, Notice, Screen, s } from '@/components/ui';
import { useDiscovery } from '@/features/connect/DiscoveryProvider';
import { DiscoveryControls } from '@/features/connect/DiscoveryControls';
import { MatchDescription } from '@/features/connect/MatchDescription';
import { discoveryTarget } from '@/features/connect/MatchNotifications';
import { useMe } from '@/features/profile/useMe';
import { matchingReadiness } from '@/features/profile/matchingReadiness';
import { discoveryEmptyState } from '@/features/connect/discoveryEmptyState';
import { AprilTagCard } from '@/features/tags/AprilTag';

export default function Connect() {
  const discovery = useDiscovery();
  const me = useMe();
  const [focused, setFocused] = useState(false);
  const locationOn = !!discovery?.presence.enabled;
  const bluetoothOn = !!discovery?.ble.state.live;
  const browserOnly = Platform.OS === 'web';
  const discoveryOn = locationOn || bluetoothOn;
  const readiness = me.data ? matchingReadiness(me.data.current_version, me.data.profile.settings, me.data.preview, !!me.data.matching_consent) : undefined;
  const empty = discoveryEmptyState({ discoveryOn, browserOnly, readiness, error: discovery?.error,
    modelUnavailable: discovery?.modelUnavailable, pending: discovery?.pending,
    bluetoothLive: bluetoothOn, encounters: discovery?.ble.encounters ?? [] });
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  return <Screen><Brand /><Heading title="Connect" subtitle="People you might enjoy a conversation with." />
    <View style={{ gap: 16 }}><DiscoveryControls /></View>
    {me.data?.april_tag && <Card title="Your Companion Charm" subtitle="A stable marker for your authorized Meta glasses connection.">
      <AprilTagCard tagId={me.data.april_tag.tag_id} markerSizeTenthsMm={me.data.april_tag.marker_size_tenths_mm} />
    </Card>}
    <View style={{ gap: 16 }} accessibilityLabel={browserOnly ? 'Location discoveries' : 'Location and Bluetooth discoveries'}>
      <Text style={s.cardTitle}>Discoveries</Text>
      {!!discovery?.error && <Notice error>{discovery.error}</Notice>}
      {discovery?.modelUnavailable && <Notice>The matching service is unavailable. Discovery can stay on while the service is restored.</Notice>}
      {!!discovery?.pending && <Notice>Checking approved conversation matches.</Notice>}
      {discovery?.busy && <ActivityIndicator />}
      {discovery?.items.map(item => <Card key={item.event_key} title={item.preview.display_name}>
        <Chips values={item.preview.interests} />
        <Body muted>{item.sources.map(source => source === 'ble' ? 'Bluetooth' : 'Location').join(' and ')} suggestion</Body>
        {focused && <MatchDescription target={discoveryTarget(item)} preview={item.preview} />}
        <Button title="View match" icon="chatbubble-outline" variant="secondary" onPress={() => discovery.open(item.event_key)} />
      </Card>)}
      {!discovery?.items.length && !discovery?.busy && <EmptyState title={empty.title} message={empty.message} />}
      <Button title="Refresh discoveries" icon="refresh-outline" variant="quiet" disabled={!discovery || (!discovery.presence.enabled && !discovery.ble.state.live)} onPress={() => void discovery?.refresh()} />
    </View>
  </Screen>;
}
