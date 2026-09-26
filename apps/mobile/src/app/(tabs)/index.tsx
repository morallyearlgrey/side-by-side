import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Brand, Button, Card, EmptyState, Heading, Notice, Screen, s } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { NearbyPage } from '@/lib/types';
import { usePresence } from '@/features/nearby/usePresence';
import { PersonCard } from '@/features/nearby/PersonCard';
import { useAuth } from '@/features/auth/AuthProvider';
import { colors } from '@/lib/theme';
import { useMe } from '@/features/profile/useMe';
import { ReadinessChecklist } from '@/features/profile/ReadinessChecklist';
import { matchingReadiness } from '@/features/profile/matchingReadiness';
export default function Nearby() {
  const me = useMe();
  const profileReady = !!me.data && matchingReadiness(me.data.current_version, me.data.profile.settings, me.data.preview, !!me.data.matching_consent).ready;
  const presence = usePresence(); const { session } = useAuth(); const client = useQueryClient();
  const query = useInfiniteQuery({ queryKey: ['nearby', session?.user.id], initialPageParam: null as string | null, queryFn: ({ pageParam, signal }) => api<NearbyPage>(`/v1/nearby?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }), getNextPageParam: page => page.next_cursor, enabled: presence.enabled, refetchInterval: 30_000 });
  const people = query.data?.pages.flatMap(page => page.items).filter(person => person.status === 'recommend') || []; const first = query.data?.pages[0];
  const refresh = () => {
    if (!presence.enabled) return;
    void presence.refresh().catch(() => {}).then(() => client.resetQueries({ queryKey: ['nearby', session?.user.id], exact: true }));
  };
  const header = <View style={{ gap: 22, marginBottom: 22 }}><Brand /><Heading eyebrow="Your world, a little more connected" title={"Interesting people.\nRight around you."} subtitle="A good conversation could be closer than you think." />
    {me.data && <ReadinessChecklist me={me.data} />}
    {me.error && <Notice error>{errorMessage(me.error)}</Notice>}
    <Card style={{ backgroundColor: colors.violetDark, borderColor: colors.violetDark }}><View style={s.row}><View style={{ backgroundColor: '#FFFFFF20', width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="navigate-outline" size={22} color="white" /></View><View style={{ flex: 1, gap: 3 }}><Text style={{ color: 'white', fontWeight: '600', fontSize: 17 }}>Your two-mile circle</Text><Text style={{ color: '#CEC8EF', fontSize: 12 }}>{presence.enabled ? 'Nearby is on · precise location stays private' : 'Choose when you want to be discovered'}</Text></View></View>{!presence.enabled && <Button title="Explore my neighborhood" onPress={() => void presence.enable()} loading={presence.busy} disabled={!profileReady} variant="secondary" />}</Card>
    {!!presence.error && <Notice error>{presence.error}</Notice>}
    {query.error && <><Notice error>{errorMessage(query.error)}</Notice><Button title="Refresh nearby people" variant="secondary" onPress={refresh} /></>}
    <View style={s.row}><Text style={[s.cardTitle, { flex: 1 }]}>People you might click with</Text><Text style={s.small}>2 mi</Text></View>
    {!!first?.pending_count && first.model.available !== false && <Notice>We’re finding the best conversation matches. This list refreshes as results are ready.</Notice>}
    {(!!first?.unavailable_count || first?.model.available === false) && <Notice>Matching is temporarily unavailable. Your profile is saved; try again when the matching service is ready.</Notice>}
    {!!first?.insufficient_evidence_count && <Notice>Some conversations need more approved information. Review your conversation request and details in Settings.</Notice>}
    {!!first?.not_recommended_count && <Notice>Some people in your circle don’t fit your current conversation request. Supported matches appear below.</Notice>}
  </View>;
  return <Screen scroll={false} style={{ paddingBottom: 0 }}><FlatList data={people} keyExtractor={person => person.user_id} contentContainerStyle={{ gap: 16, paddingBottom: 30 }} showsVerticalScrollIndicator={false} ListHeaderComponent={header} renderItem={({ item, index }) => <PersonCard userId={item.user_id} preview={item.preview} rank={index + 1} />} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={refresh} tintColor={colors.violet} />} onEndReachedThreshold={.5} onEndReached={() => { if (query.hasNextPage && !query.isFetching) void query.fetchNextPage(); }}
    ListEmptyComponent={presence.enabled && query.isPending ? <ActivityIndicator color={colors.violet} /> : <EmptyState title={presence.enabled ? 'A little room for possibility.' : 'Start with your neighborhood.'} message={presence.enabled ? 'There aren’t any ready matches in your circle yet. Come back as more people join.' : 'Enable Nearby to see people who have chosen to be discovered within two miles.'} />}
    ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.violet} /> : people.length > 0 ? <Text style={[s.small, { textAlign: 'center', paddingVertical: 12 }]}>Ordered by conversational relevance. Connection is always your choice.</Text> : null} />
  </Screen>;
}
