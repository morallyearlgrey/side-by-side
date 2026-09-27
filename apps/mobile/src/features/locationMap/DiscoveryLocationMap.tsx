import { StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, Notice } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';
import GoogleLocationMap from './GoogleLocationMap';
import { mapAreas, visibleEstimates } from './types';
import { useLocationMap } from './useLocationMap';

export default function DiscoveryLocationMap({ userId, locationEnabled, bluetoothEnabled, sharingAllowed = true, onUpdateLocation, updatingLocation = false, embedded = false, allowedCandidateIds = [] }: {
  userId: string; locationEnabled: boolean; bluetoothEnabled: boolean; sharingAllowed?: boolean;
  onUpdateLocation?: () => void; updatingLocation?: boolean; embedded?: boolean; allowedCandidateIds?: string[];
}) {
  const query = useLocationMap(userId, locationEnabled && sharingAllowed, bluetoothEnabled && sharingAllowed);
  const allowed = new Set(allowedCandidateIds);
  const areas = mapAreas(query.data, query.clock).filter(area => area.own || allowed.has(area.id));
  const people = visibleEstimates(query.data, query.clock).filter(item => allowed.has(item.user_id));
  const content = <View style={{ gap: 14 }}>
    <Text style={styles.name}>Nearby matches</Text>
    <Body muted>Map areas are approximate. Open a card below to review approved details and choose whether to connect.</Body>
    {!sharingAllowed ? <Notice>Map sharing needs an available profile, matching consent, and an enabled profile preview.</Notice>
      : !locationEnabled && !bluetoothEnabled ? <Notice>Enable location discovery to show your area and nearby people on Google Maps.</Notice>
      : query.isError ? <Notice error>{errorMessage(query.error)}</Notice>
        : query.isPending ? <Body muted>Checking nearby location estimates…</Body>
          : query.data?.status === 'off' ? <Notice>Map sharing needs an available profile, matching consent, and an enabled profile preview.</Notice>
            : !areas.length ? <Notice>A current shared location is needed to place nearby people on a map. Enable location discovery and update your location. Bluetooth alone cannot determine a geographic position.</Notice>
              : <><GoogleLocationMap areas={areas} />
                <Body muted>Your approximate area was last updated at {new Date(areas[0].observed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</Body>
                <View style={styles.legend}><View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.teal }]} /><Text style={styles.legendText}>Your area</Text></View>
                  <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.accent }]} /><Text style={styles.legendText}>Nearby areas</Text></View></View>
                <Body muted>{people.length ? `${people.length} nearby ${people.length === 1 ? 'match' : 'matches'} with an open invitation.` : 'No nearby matches with open invitations right now.'}</Body></>}
    {sharingAllowed && locationEnabled && onUpdateLocation && <Button title="Update my location" variant="secondary" icon="locate-outline"
      loading={updatingLocation} onPress={onUpdateLocation} />}
    {sharingAllowed && (locationEnabled || bluetoothEnabled) && <Button title="Refresh nearby map" variant="quiet" icon="refresh-outline"
      loading={query.isFetching} onPress={() => { void query.refetch(); }} />}
  </View>;
  return embedded ? content : <Card title="Nearby map" subtitle="Approximate areas, with location uncertainty">{content}</Card>;
}
const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { height: 10, width: 10, borderRadius: 5 }, legendText: { color: colors.muted, fontSize: 13 },
  name: { color: colors.ink, fontSize: 15, fontWeight: '500' },
});
