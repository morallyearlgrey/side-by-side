import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Body, Button, Card, Notice } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { Connection } from '@/lib/types';
import GoogleLocationMap from './GoogleLocationMap';
import { estimateCaption, mapAreas, visibleEstimates } from './types';
import { useLocationMap } from './useLocationMap';

function NearbyPerson({ userId, item, connected }: { userId: string; item: ReturnType<typeof visibleEstimates>[number]; connected: boolean }) {
  const client = useQueryClient();
  const router = useRouter();
  const invite = useMutation({ mutationFn: () => api<Connection>('/v1/connections', {
    method: 'POST', expectedUserId: userId,
    body: { candidate_id: item.user_id, mode: item.source === 'bluetooth' ? 'ble' : 'nearby' },
  }), onSuccess: () => {
    void client.invalidateQueries({ queryKey: ['connections'] });
    void client.invalidateQueries({ queryKey: ['discoveries'] });
  } });
  const result = invite.data;
  return <View style={styles.person}>
    <Text style={styles.name}>{item.display_name}</Text><Body muted>{estimateCaption(item)}</Body>
    {connected || result?.status === 'accepted'
      ? <Button title="View saved connection" variant="secondary" onPress={() => router.push('/matches')} />
      : result?.status === 'pending'
        ? <Body muted>Your invitation appears for both people here. It moves to Matches when both accept.</Body>
        : <Button title="Try to connect" variant="secondary" loading={invite.isPending} onPress={() => invite.mutate()} />}
    {invite.error && <Notice error>{invite.error instanceof ApiError && invite.error.code === 'score_not_ready'
      ? 'The current matching check does not support an invitation for this pair. You can review your goal and approved details in Profile.'
      : errorMessage(invite.error)}</Notice>}
  </View>;
}

export default function DiscoveryLocationMap({ userId, locationEnabled, bluetoothEnabled, sharingAllowed = true, onUpdateLocation, updatingLocation = false, embedded = false, hiddenCandidateIds = [] }: {
  userId: string; locationEnabled: boolean; bluetoothEnabled: boolean; sharingAllowed?: boolean;
  onUpdateLocation?: () => void; updatingLocation?: boolean; embedded?: boolean; hiddenCandidateIds?: string[];
}) {
  const query = useLocationMap(userId, locationEnabled && sharingAllowed, bluetoothEnabled && sharingAllowed);
  const areas = mapAreas(query.data, query.clock);
  const people = visibleEstimates(query.data, query.clock);
  const connections = useQuery({ queryKey: ['connections', 'nearby-status', userId],
    queryFn: ({ signal }) => api<{ items: Connection[] }>('/v1/connections', { signal, expectedUserId: userId }),
    enabled: query.enabled, staleTime: 0, refetchInterval: 15_000, retry: false });
  const connectedIds = new Set(connections.data?.items.filter(item => item.requester_decision === 'accepted'
    && item.recipient_decision === 'accepted').map(item => item.candidate_id));
  const content = <View style={{ gap: 14 }}>
    <Text style={styles.name}>Nearby map and profiles</Text>
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
    {people.filter(item => !hiddenCandidateIds.includes(item.user_id)).map(item =>
      <NearbyPerson key={item.user_id} item={item} userId={userId} connected={connectedIds.has(item.user_id)} />)}
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
  person: { gap: 4, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 },
  name: { color: colors.ink, fontSize: 15, fontWeight: '500' },
});
