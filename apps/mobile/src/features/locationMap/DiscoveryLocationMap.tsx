import { StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, Notice } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';
import GoogleLocationMap from './GoogleLocationMap';
import { estimateCaption, mapAreas, visibleEstimates } from './types';
import { useLocationMap } from './useLocationMap';

export default function DiscoveryLocationMap({ userId, locationEnabled, bluetoothEnabled, sharingAllowed = true, onUpdateLocation, updatingLocation = false }: {
  userId: string; locationEnabled: boolean; bluetoothEnabled: boolean; sharingAllowed?: boolean;
  onUpdateLocation?: () => void; updatingLocation?: boolean;
}) {
  const query = useLocationMap(userId, locationEnabled && sharingAllowed, bluetoothEnabled && sharingAllowed);
  const areas = mapAreas(query.data, query.clock);
  const people = visibleEstimates(query.data, query.clock);
  return <Card title="Nearby map" subtitle="Approximate areas, with location uncertainty">
    <Body muted>Location circles are deliberately rounded for privacy. Nearby detection does not mean the model recommended a match.</Body>
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
                <Body muted>{people.length ? `${people.length} nearby ${people.length === 1 ? 'person' : 'people'} with sharing enabled.` : 'No other eligible people detected right now.'}</Body></>}
    {people.map(item => <View key={item.user_id} style={styles.person}>
      <Text style={styles.name}>{item.display_name}</Text><Body muted>{estimateCaption(item)}</Body>
    </View>)}
    {sharingAllowed && locationEnabled && onUpdateLocation && <Button title="Update my location" variant="secondary" icon="locate-outline"
      loading={updatingLocation} onPress={onUpdateLocation} />}
    {sharingAllowed && (locationEnabled || bluetoothEnabled) && <Button title="Refresh nearby map" variant="quiet" icon="refresh-outline"
      loading={query.isFetching} onPress={() => { void query.refetch(); }} />}
  </Card>;
}
const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { height: 10, width: 10, borderRadius: 5 }, legendText: { color: colors.muted, fontSize: 13 },
  person: { gap: 4, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 },
  name: { color: colors.ink, fontSize: 15, fontWeight: '500' },
});
