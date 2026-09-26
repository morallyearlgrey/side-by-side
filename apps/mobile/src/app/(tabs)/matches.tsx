import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Body, Brand, Button, Card, Chips, EmptyState, Field, Heading, Label, Notice, Screen, s } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import type { Connection, ConnectionsPage } from '@/lib/types';
import { ConnectionMeetup } from '@/features/meetup/ConnectionMeetup';
import { MatchPreference } from '@/features/connect/MatchPreference';
import { MatchDescription } from '@/features/connect/MatchDescription';
import { useDiscovery } from '@/features/connect/DiscoveryProvider';
import { colors } from '@/lib/theme';
import { connectionPagePath, type ConnectionFilter } from '@/features/connect/connectionQuery';
import { Constellation } from '@/features/constellation/Constellation';
import { starColor, visibleStars, type StarNode } from '@/features/constellation/geometry';

function ConnectionCard({ item, userId }: { item: Connection; userId: string }) {
  const client = useQueryClient(); const [feedback, setFeedback] = useState(false); const discovery = useDiscovery();
  const [expanded, setExpanded] = useState(false);
  const hide = async () => { discovery?.hide(); await client.cancelQueries({ queryKey: ['connections', 'constellation', userId] }); client.setQueryData(['connections', 'constellation', userId], { nodes: [] }); };
  const ownDecision = item.requester_id === userId ? item.requester_decision : item.recipient_decision;
  const change = useMutation({ mutationFn: (decision: string) => api(`/v1/connections/${item.request_id}/decision`, { method: 'PUT', expectedUserId: userId, body: { decision } }), onMutate: hide, onSuccess: () => void client.invalidateQueries({ queryKey: ['connections'] }) });
  const rate = useMutation({ mutationFn: (useful: boolean) => api('/v1/feedback', { method: 'POST', expectedUserId: userId, body: { connection_id: item.request_id, conversation_useful: useful, would_talk_again: null } }), onSuccess: () => setFeedback(true) });
  const block = useMutation({ mutationFn: () => api(`/v1/blocks/${item.requester_id === userId ? item.recipient_id : item.requester_id}`, { method: 'POST', expectedUserId: userId }), onMutate: hide, onSuccess: () => { void client.invalidateQueries({ queryKey: ['connections'] }); void client.invalidateQueries({ queryKey: ['discoveries'] }); } });
  const error = change.error || rate.error || block.error;
  const sensitive = ['pending', 'accepted'].includes(item.status) && !change.isPending && !block.isPending && !block.isSuccess && !(change.isSuccess && change.variables !== 'accepted');
  const target = { candidate_id: item.candidate_id, viewer_version_id: item.viewer_version_id, candidate_version_id: item.candidate_version_id, connection_id: item.request_id };
  const name = sensitive ? item.preview?.display_name || 'Connection' : 'Connection';
  return <Card style={{ flex: 1 }}><View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.eyebrow}>{item.status.replaceAll('_', ' ')}</Text><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: starColor(item.preference) }} /></View><Text style={s.cardTitle}>{name}</Text>{sensitive && <Chips values={item.preview?.interests || []} />}
    {sensitive && <MatchPreference target={target} preference={item.preference} />}
    <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? 'Hide' : 'Show'} details for ${name}`} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={[s.row, { justifyContent: 'space-between', minHeight: 44 }]}><Text style={s.small}>{expanded ? 'Less' : 'Connection details'}</Text><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.violet} /></Pressable>
    {expanded && <>
    {item.status === 'accepted' && !change.isPending && !block.isPending && !block.isSuccess && !(change.isSuccess && change.variables === 'revoked') && <ConnectionMeetup requestId={item.request_id} userId={userId} peerName={item.preview?.display_name || 'your connection'} />}
    {item.status === 'pending' && <><Body muted>{ownDecision === 'accepted' ? 'Your invitation is waiting for a reply.' : 'Someone would like to say hello. Accept to share the details you both approved.'}</Body>{ownDecision !== 'accepted' && <Button title="Accept invitation" loading={change.isPending} onPress={() => change.mutate('accepted')} />}<Button title={ownDecision === 'accepted' ? 'Cancel invitation' : 'Decline'} variant="quiet" disabled={change.isPending} onPress={() => change.mutate(ownDecision === 'accepted' ? 'revoked' : 'declined')} /></>}
    {item.status === 'accepted' && sensitive && <><Body>You both said yes. Here’s what they chose to share.</Body>{item.shared_profile?.facts?.map((fact, i) => <View key={i} style={{ gap: 5 }}><Label>{fact.topic}</Label><Body muted>{fact.details}</Body></View>)}{item.shared_profile?.facts?.length === 0 && <Body muted>No additional details have been shared yet.</Body>}<MatchDescription target={target} />{feedback ? <Notice>Thanks. Your feedback stays private.</Notice> : <><Label>After a conversation: was it useful?</Label><View style={s.row}><Button title="Yes" variant="secondary" disabled={rate.isPending} onPress={() => rate.mutate(true)} /><Button title="Not this time" variant="quiet" disabled={rate.isPending} onPress={() => rate.mutate(false)} /></View></>}<Button title="End this connection" variant="quiet" disabled={change.isPending} onPress={() => change.mutate('revoked')} /></>}
    {['profile_changed', 'unavailable'].includes(item.status) && <Body muted>This connection is no longer current. New profile details require a new invitation.</Body>}
    {!['unavailable', 'revoked', 'declined'].includes(item.status) && <Button title="Block this person" variant="quiet" disabled={block.isPending} onPress={() => block.mutate()} />}
    </>}
    {error && <Notice error>{errorMessage(error)}</Notice>}
  </Card>;
}
export default function Matches() {
  const { session } = useAuth(); const [search, setSearch] = useState(''); const [filter, setFilter] = useState<ConnectionFilter>('all'); const [page, setPage] = useState(1);
  const [active, setActive] = useState(false); const [since, setSince] = useState(Date.now());
  const [clock, setClock] = useState(Date.now()); const { width } = useWindowDimensions();
  useEffect(() => { if (!active) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  const focused = useRef(false);
  useFocusEffect(useCallback(() => { focused.current = true; setSince(Date.now()); setActive(AppState.currentState === 'active'); return () => { focused.current = false; setActive(false); }; }, []));
  useEffect(() => { const sub = AppState.addEventListener('change', state => { setSince(Date.now()); setActive(focused.current && state === 'active'); }); return () => sub.remove(); }, []);
  const query = useQuery({ queryKey: ['connections', session?.user.id, search, filter, page],
    queryFn: ({ signal }) => api<ConnectionsPage>(connectionPagePath(search, filter, page), { signal, expectedUserId: session?.user.id }),
    enabled: !!session && active, refetchInterval: 10_000, staleTime: 0, retry: false });
  const graph = useQuery({ queryKey: ['connections', 'constellation', session?.user.id],
    queryFn: ({ signal }) => api<{ nodes: StarNode[] }>('/v1/connections/constellation', { signal, expectedUserId: session?.user.id }),
    enabled: !!session && active, refetchInterval: 10_000, staleTime: 0, retry: false });
  useEffect(() => { if (query.data && query.data.page !== page) setPage(query.data.page); }, [query.data, page]);
  const result = active && !query.error && query.dataUpdatedAt >= since && clock-query.dataUpdatedAt < 20_000 ? query.data : undefined;
  const stars = active && !graph.error && graph.dataUpdatedAt >= since && clock-graph.dataUpdatedAt < 20_000 ? graph.data?.nodes : undefined;
  return <Screen style={{ maxWidth: 960 }}><Brand /><Heading title="Matches" subtitle="People in your orbit." />
    {stars ? <Constellation nodes={visibleStars(stars, filter)} active={active} onSelect={node => { setSearch(node.display_name); setFilter('all'); setPage(1); }} /> : <View style={{ minHeight: 140, justifyContent: 'center' }}>{graph.error ? <Notice error>Constellation unavailable. {errorMessage(graph.error)}</Notice> : <ActivityIndicator accessibilityLabel="Loading constellation" color={colors.violet} />}</View>}
    <Field label="Search connections" placeholder="Names, interests, shared details" value={search} maxLength={200} onChangeText={value => { setSearch(value); setPage(1); }} />
    <View accessibilityRole="radiogroup" style={[s.row, { gap: 4, alignSelf: 'flex-start', borderRadius: 24, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.input, padding: 4 }]}>{(['all', 'liked', 'disliked'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value[0].toUpperCase()+value.slice(1)} accessibilityState={{ checked: filter === value }} onPress={() => { setFilter(value); setPage(1); }} style={{ minHeight: 40, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: filter === value ? colors.lavender : 'transparent' }}><Text style={{ fontSize: 13, fontWeight: '600', color: filter === value ? colors.ink : colors.muted }}>{value[0].toUpperCase()+value.slice(1)}</Text></Pressable>)}</View>
    <View style={{ minHeight: 22 }}>{query.isFetching && <ActivityIndicator color={colors.violet} />}{!query.isFetching && result && <Text style={s.small}>{result.total} {result.total === 1 ? 'connection' : 'connections'}</Text>}</View>
    {query.error && <Notice error>{errorMessage(query.error)}</Notice>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>{result?.items.map(item => <View key={item.request_id} style={{ width: width >= 720 ? '48.5%' : '100%' }}><ConnectionCard item={item} userId={session!.user.id} /></View>)}</View>
    {result?.items.length === 0 && <EmptyState icon="chatbubbles-outline" title="No connections found." message="Try another search or filter. Invitations can be sent from Connect." />}
    {!!result && result.total > 0 && <View style={{ gap: 12, alignItems: 'center' }}><Text accessibilityLiveRegion="polite" style={s.small}>Page {result.page} of {result.pages}</Text><View style={[s.row, { maxWidth: '100%', gap: 4 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous" disabled={result.page <= 1 || query.isFetching} onPress={() => setPage(page-1)} style={{ padding: 12, opacity: result.page <= 1 ? .3 : 1 }}><Ionicons name="chevron-back" size={20} color={colors.ink} /></Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>{Array.from({ length: result.pages }, (_, i) => <Pressable key={i} accessibilityRole="button" accessibilityLabel={`Page ${i+1}`} accessibilityState={{ selected: result.page === i+1 }} disabled={query.isFetching} onPress={() => setPage(i+1)} style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: result.page === i+1 ? colors.ink : '#726A7E' }} /></Pressable>)}</ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Next" disabled={result.page >= result.pages || query.isFetching} onPress={() => setPage(page+1)} style={{ padding: 12, opacity: result.page >= result.pages ? .3 : 1 }}><Ionicons name="chevron-forward" size={20} color={colors.ink} /></Pressable>
    </View></View>}
  </Screen>;
}
