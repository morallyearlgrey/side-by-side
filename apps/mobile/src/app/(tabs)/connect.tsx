import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Body, Brand, Button, Card, Chips, EmptyState, Notice, Screen, s } from '@/components/ui';
import { useDiscovery } from '@/features/connect/DiscoveryProvider';
import { DiscoveryControls } from '@/features/connect/DiscoveryControls';
import { MatchingConsent } from '@/features/connect/MatchingConsent';
import { MatchDescription } from '@/features/connect/MatchDescription';
import { discoveryTarget } from '@/features/connect/MatchNotifications';
import { ConnectHero, EclipseDivider } from '@/features/connect/ConnectHero';
import { useMe } from '@/features/profile/useMe';
import { PreviewSettings } from '@/features/profile/PreviewSettings';
import { matchingReadiness } from '@/features/profile/matchingReadiness';
import { discoveryEmptyState } from '@/features/connect/discoveryEmptyState';
import { AprilTagCard } from '@/features/tags/AprilTag';
import { ConnectionInvitations } from '@/features/connect/ConnectionInvitations';
import DiscoveryLocationMap from '@/features/locationMap/DiscoveryLocationMap';
import { api, errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { Discovery } from '@/lib/types';

function DiscoveryCard({ item, focused }: { item: Discovery; focused: boolean }) {
  const client = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [interested, setInterested] = useState(false);
  const invite = useMutation({ mutationFn: () => api('/v1/connections', { method: 'POST', body: { candidate_id: item.candidate_id, mode: item.mode } }),
    onSuccess: () => { setInterested(true); void client.invalidateQueries({ queryKey: ['connections'] }); } });
  if (dismissed) return null;
  return <Card style={{ backgroundColor: 'rgba(69,48,39,.36)', borderColor: '#FF6D2970', shadowColor: colors.violet, shadowOpacity: .15, shadowRadius: 20 }}>
    <Text style={s.eyebrow}>{item.sources.map(source => source === 'ble' ? 'Bluetooth' : 'Location').join(' · ')} discovery</Text>
    <Text style={s.cardTitle}>{item.preview.display_name}</Text>
    <Chips values={item.preview.interests} />
    {focused && <MatchDescription target={discoveryTarget(item)} preview={item.preview} />}
    {interested ? <Body muted>Invitation saved for both people in Connect. This moves to Matches after you both accept.</Body>
      : <View style={{ gap: 8 }}><Button title="Interested" icon="heart-outline" onPress={() => invite.mutate()} loading={invite.isPending} />
        <Button title="Decline suggestion" icon="close-outline" variant="quiet" onPress={() => setDismissed(true)} /></View>}
    {!!invite.error && <Notice error>{errorMessage(invite.error)}</Notice>}
  </Card>;
}

export default function Connect() {
  const discovery = useDiscovery();
  const me = useMe();
  const { width } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  const locationOn = !!discovery?.presence.enabled;
  const bluetoothOn = !!discovery?.ble.state.live;
  const browserOnly = Platform.OS === 'web';
  const desktop = browserOnly && width >= 1024;
  const discoveryOn = locationOn || bluetoothOn;
  const readiness = me.data ? matchingReadiness(me.data.current_version, me.data.profile.settings, me.data.preview, !!me.data.matching_consent) : undefined;
  const empty = discoveryEmptyState({ discoveryOn, browserOnly, readiness, error: discovery?.error,
    modelUnavailable: discovery?.modelUnavailable, pending: discovery?.pending, outcomes: discovery?.outcomes,
    bluetoothLive: bluetoothOn, encounters: discovery?.ble.encounters ?? [] });
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  return <Screen><Brand /><ConnectHero />
    <View style={{ flexDirection: desktop ? 'row' : 'column', alignItems: 'flex-start', gap: desktop ? 28 : 22 }}>
      <View style={{ width: desktop ? '38%' : '100%', gap: 20 }}>
        <Card title="Discovery controls" subtitle="Choose how people can find you while SidebySide is open." defaultExpanded={false} style={{ backgroundColor: 'rgba(69,48,39,.32)' }}><MatchingConsent /><DiscoveryControls /></Card>
        {me.data?.april_tag && <Card title="Companion Charm ID" subtitle="Tap to show or hide your stable marker for authorized Meta glasses recognition." defaultExpanded={false}>
          <AprilTagCard tagId={me.data.april_tag.tag_id} markerSizeTenthsMm={me.data.april_tag.marker_size_tenths_mm} />
        </Card>}
        {me.data && <PreviewSettings key={JSON.stringify(me.data.preview)} preview={me.data.preview} userId={me.data.profile.user_id} />}
      </View>
      <View style={{ flex: desktop ? 1 : undefined, width: desktop ? undefined : '100%', gap: 20 }}>
        <Card title="Discoveries" subtitle="See nearby people, invitations, and recommended conversations together." style={{ backgroundColor: 'rgba(69,48,39,.32)' }}>
        <EclipseDivider />
        {!!me.data?.profile.user_id && <DiscoveryLocationMap userId={me.data.profile.user_id} locationEnabled={locationOn} bluetoothEnabled={bluetoothOn}
          sharingAllowed={!!me.data.matching_consent && !!me.data.preview?.enabled}
          onUpdateLocation={() => { discovery?.hide(); void discovery?.presence.refresh(); }} updatingLocation={discovery?.presence.stage !== 'idle'}
          hiddenCandidateIds={discovery?.items.map(item => item.candidate_id) || []} embedded />}
        <ConnectionInvitations active={focused} embedded />
        <View style={{ gap: 16 }} accessibilityLabel={browserOnly ? 'Location discoveries' : 'Location and Bluetooth discoveries'}>
          <Text style={s.cardTitle}>Recommended conversations</Text>
          {!!discovery?.error && <Notice error>{discovery.error}</Notice>}
          {discovery?.modelUnavailable && <Notice>The matching service is unavailable. Discovery can stay on while the service is restored.</Notice>}
          {!!discovery?.pending && <Notice>Checking approved conversation matches.</Notice>}
          {discovery?.busy && <ActivityIndicator />}
          {discovery?.items.map(item => <DiscoveryCard key={item.event_key} item={item} focused={focused} />)}
          {!discovery?.items.length && !discovery?.busy && <EmptyState title={empty.title} message={empty.message} />}
          <Button title="Refresh discoveries" icon="refresh-outline" variant="quiet" disabled={!discovery || (!discovery.presence.enabled && !discovery.ble.state.live)} onPress={() => void discovery?.refresh()} />
        </View>
        </Card>
      </View>
    </View>
  </Screen>;
}
