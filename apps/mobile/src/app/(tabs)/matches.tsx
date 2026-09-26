import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View } from 'react-native';
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

function ConnectionCard({ item, userId }: { item: Connection; userId: string }) {
  const client = useQueryClient(); const [feedback, setFeedback] = useState(false); const discovery = useDiscovery();
  const ownDecision = item.requester_id === userId ? item.requester_decision : item.recipient_decision;
  const change = useMutation({ mutationFn: (decision: string) => api(`/v1/connections/${item.request_id}/decision`, { method: 'PUT', expectedUserId: userId, body: { decision } }), onMutate: () => discovery?.hide(), onSuccess: () => void client.invalidateQueries({ queryKey: ['connections'] }) });
  const rate = useMutation({ mutationFn: (useful: boolean) => api('/v1/feedback', { method: 'POST', expectedUserId: userId, body: { connection_id: item.request_id, conversation_useful: useful, would_talk_again: null } }), onSuccess: () => setFeedback(true) });
  const block = useMutation({ mutationFn: () => api(`/v1/blocks/${item.requester_id === userId ? item.recipient_id : item.requester_id}`, { method: 'POST', expectedUserId: userId }), onMutate: () => discovery?.hide(), onSuccess: () => { void client.invalidateQueries({ queryKey: ['connections'] }); void client.invalidateQueries({ queryKey: ['discoveries'] }); } });
  const error = change.error || rate.error || block.error;
  const sensitive = ['pending', 'accepted'].includes(item.status) && !change.isPending && !block.isPending && !block.isSuccess && !(change.isSuccess && change.variables !== 'accepted');
  const target = { candidate_id: item.candidate_id, viewer_version_id: item.viewer_version_id, candidate_version_id: item.candidate_version_id, connection_id: item.request_id };
  return <Card><Text style={s.eyebrow}>{item.status.replaceAll('_', ' ')}</Text><Text style={s.cardTitle}>{sensitive ? item.preview?.display_name || 'Connection' : 'Connection'}</Text>{sensitive && <Chips values={item.preview?.interests || []} />}
    {sensitive && <MatchPreference target={target} preference={item.preference} />}
    {item.status === 'accepted' && !change.isPending && !block.isPending && !block.isSuccess && !(change.isSuccess && change.variables === 'revoked') && <ConnectionMeetup requestId={item.request_id} userId={userId} peerName={item.preview?.display_name || 'your connection'} />}
    {item.status === 'pending' && <><Body muted>{ownDecision === 'accepted' ? 'Your invitation is waiting for a reply.' : 'Someone would like to say hello. Accept to share the details you both approved.'}</Body>{ownDecision !== 'accepted' && <Button title="Accept invitation" loading={change.isPending} onPress={() => change.mutate('accepted')} />}<Button title={ownDecision === 'accepted' ? 'Cancel invitation' : 'Decline'} variant="quiet" disabled={change.isPending} onPress={() => change.mutate(ownDecision === 'accepted' ? 'revoked' : 'declined')} /></>}
    {item.status === 'accepted' && sensitive && <><Body>You both said yes. Here’s what they chose to share.</Body>{item.shared_profile?.facts?.map((fact, i) => <View key={i} style={{ gap: 5 }}><Label>{fact.topic}</Label><Body muted>{fact.details}</Body></View>)}{item.shared_profile?.facts?.length === 0 && <Body muted>No additional details have been shared yet.</Body>}<MatchDescription target={target} />{feedback ? <Notice>Thanks. Your feedback stays private.</Notice> : <><Label>After a conversation: was it useful?</Label><View style={s.row}><Button title="Yes" variant="secondary" disabled={rate.isPending} onPress={() => rate.mutate(true)} /><Button title="Not this time" variant="quiet" disabled={rate.isPending} onPress={() => rate.mutate(false)} /></View></>}<Button title="End this connection" variant="quiet" disabled={change.isPending} onPress={() => change.mutate('revoked')} /></>}
    {['profile_changed', 'unavailable'].includes(item.status) && <Body muted>This connection is no longer current. New profile details require a new invitation.</Body>}
    {!['unavailable', 'revoked', 'declined'].includes(item.status) && <Button title="Block this person" variant="quiet" disabled={block.isPending} onPress={() => block.mutate()} />}
    {error && <Notice error>{errorMessage(error)}</Notice>}
  </Card>;
}
export default function Matches() {
  const { session } = useAuth(); const [search, setSearch] = useState(''); const [filter, setFilter] = useState<ConnectionFilter>('all'); const [page, setPage] = useState(1);
  const [active, setActive] = useState(false); const [since, setSince] = useState(Date.now());
  const focused = useRef(false);
  useFocusEffect(useCallback(() => { focused.current = true; setSince(Date.now()); setActive(AppState.currentState === 'active'); return () => { focused.current = false; setActive(false); }; }, []));
  useEffect(() => { const sub = AppState.addEventListener('change', state => { setSince(Date.now()); setActive(focused.current && state === 'active'); }); return () => sub.remove(); }, []);
  const query = useQuery({ queryKey: ['connections', session?.user.id, search, filter, page],
    queryFn: ({ signal }) => api<ConnectionsPage>(connectionPagePath(search, filter, page), { signal, expectedUserId: session?.user.id }),
    enabled: !!session && active, refetchInterval: 10_000, staleTime: 0, retry: false });
  useEffect(() => { if (query.data && query.data.page !== page) setPage(query.data.page); }, [query.data, page]);
  const result = active && !query.error && query.dataUpdatedAt >= since ? query.data : undefined;
  return <Screen><Brand /><Heading title="Matches" subtitle="Your invitations and connections." />
    <Field label="Search connections" value={search} maxLength={200} onChangeText={value => { setSearch(value); setPage(1); }} />
    <View accessibilityRole="radiogroup" style={s.chips}>{(['all', 'liked', 'disliked'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: filter === value }} onPress={() => { setFilter(value); setPage(1); }} style={[s.chip, filter === value && { backgroundColor: colors.violet }]}><Text style={[s.chipText, filter === value && { color: 'white' }]}>{value[0].toUpperCase()+value.slice(1)}</Text></Pressable>)}</View>
    {query.isFetching && <ActivityIndicator />}{query.error && <><Notice error>{errorMessage(query.error)}</Notice><Button title="Try again" onPress={() => void query.refetch()} /></>}
    {result?.items.map(item => <ConnectionCard key={item.request_id} item={item} userId={session!.user.id} />)}
    {result?.items.length === 0 && <EmptyState icon="chatbubbles-outline" title="No connections found." message="Try another search or filter. Invitations can be sent from Connect." />}
    <View style={{ gap: 12 }}><Text accessibilityLiveRegion="polite" style={s.small}>Page {result?.page || page} of {result?.pages || 1}{result ? ` · ${result.total} results` : ''}</Text><View style={[s.row, { flexWrap: 'wrap' }]}>
      <Button title="Previous" icon="chevron-back" variant="secondary" disabled={!result || result.page <= 1 || query.isFetching} onPress={() => setPage(page-1)} />
      <Button title="Next" icon="chevron-forward" variant="secondary" disabled={!result || result.page >= result.pages || query.isFetching} onPress={() => setPage(page+1)} />
    </View></View>
  </Screen>;
}
