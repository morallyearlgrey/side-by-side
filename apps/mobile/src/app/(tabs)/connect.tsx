import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Brand, Button, Card, EmptyState, Notice, Screen } from '@/components/ui';
import { useDiscovery } from '@/features/connect/DiscoveryProvider';
import { DiscoveryControls } from '@/features/connect/DiscoveryControls';
import { MatchingConsent } from '@/features/connect/MatchingConsent';
import { ConnectHero, EclipseDivider } from '@/features/connect/ConnectHero';
import { useMe } from '@/features/profile/useMe';
import { PreviewSettings } from '@/features/profile/PreviewSettings';
import { matchingReadiness } from '@/features/profile/matchingReadiness';
import { discoveryEmptyState } from '@/features/connect/discoveryEmptyState';
import { AprilTagCard } from '@/features/tags/AprilTag';
import { InvitationCard, useConnectionInvitations } from '@/features/connect/ConnectionInvitations';
import DiscoveryLocationMap from '@/features/locationMap/DiscoveryLocationMap';

export default function Connect() {
  const discovery = useDiscovery();
  const me = useMe();
  const { width } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  const invitations = useConnectionInvitations(focused);
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
        <Card title="Discoveries" subtitle="Review model-supported nearby matches and decide together." style={{ backgroundColor: 'rgba(69,48,39,.32)' }}>
        <EclipseDivider />
        {!!me.data?.profile.user_id && <DiscoveryLocationMap userId={me.data.profile.user_id} locationEnabled={locationOn} bluetoothEnabled={bluetoothOn}
          sharingAllowed={!!me.data.matching_consent && !!me.data.preview?.enabled}
          onUpdateLocation={() => { discovery?.hide(); void discovery?.presence.refresh(); }} updatingLocation={discovery?.presence.stage !== 'idle'}
          allowedCandidateIds={invitations.items.map(item => item.candidate_id)} embedded />}
        <View style={{ gap: 16 }} accessibilityLabel={browserOnly ? 'Location discoveries' : 'Location and Bluetooth discoveries'}>
          {!!discovery?.error && <Notice error>{discovery.error}</Notice>}
          {invitations.query.error && <Notice error>Invitations could not be refreshed. Please try again.</Notice>}
          {discovery?.modelUnavailable && <Notice>The matching service is unavailable. Discovery can stay on while the service is restored.</Notice>}
          {!!discovery?.pending && <Notice>Checking approved conversation matches.</Notice>}
          {(discovery?.busy || invitations.query.isFetching) && <ActivityIndicator />}
          {invitations.userId && invitations.items.map(item => <InvitationCard key={item.request_id} item={item} userId={invitations.userId!}
            suggestion={discovery?.items.find(suggestion => suggestion.candidate_id === item.candidate_id)} />)}
          {invitations.current && invitations.items.length === 0 && !discovery?.busy && <EmptyState title={empty.title} message={empty.message} />}
          <Button title="Refresh matches" icon="refresh-outline" variant="quiet" disabled={!discovery || !invitations.visible}
            onPress={() => { void discovery?.refresh(); void invitations.query.refetch(); }} />
        </View>
        </Card>
      </View>
    </View>
  </Screen>;
}
