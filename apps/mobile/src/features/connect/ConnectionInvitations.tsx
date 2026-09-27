import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Body, Button, Card, Chips, Notice, s } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import type { Connection } from '@/lib/types';
import { MatchDescription } from './MatchDescription';
import { isPendingInvitation } from './connectionVisibility';

export function InvitationCard({ item, userId }: { item: Connection; userId: string }) {
  const client = useQueryClient();
  const ownDecision = item.requester_id === userId ? item.requester_decision : item.recipient_decision;
  const peerDecision = item.requester_id === userId ? item.recipient_decision : item.requester_decision;
  const waiting = ownDecision === 'accepted';
  const change = useMutation({
    mutationFn: (decision: 'accepted' | 'declined' | 'revoked') => api<Connection>(`/v1/connections/${item.request_id}/decision`, {
      method: 'PUT', expectedUserId: userId, body: { decision },
    }),
    onMutate: () => { client.removeQueries({ queryKey: ['descriptions'] }); },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['connections'] });
      void client.invalidateQueries({ queryKey: ['discoveries'] });
    },
  });
  // An expired or terminal row must never expose a pending preview, even if
  // cached data survives until the next poll.
  if (!isPendingInvitation(item, userId)) return null;
  const sensitive = !change.isPending && !change.isSuccess;
  const suggested = ownDecision === 'pending' && peerDecision === 'pending';
  return <Card title={sensitive ? item.preview?.display_name || 'Connection suggestion' : 'Connection suggestion'}>
    <Text style={s.eyebrow}>{suggested ? 'Connection suggestion' : 'Invitation'}</Text>
    {sensitive && <>
      <Chips values={item.preview?.interests || []} />
      <Body muted>{waiting
        ? 'You said yes. Waiting for their acceptance. You will both see this connection in Matches once they accept.'
        : peerDecision === 'accepted'
          ? 'They said yes and invited you to connect. Accept to share the details you both approved and add this connection to Matches.'
          : 'A nearby connection was suggested to both of you. Neither person has accepted yet. It appears in Matches only after you both say yes.'}</Body>
      {item.preview && <MatchDescription target={{ candidate_id: item.candidate_id,
        viewer_version_id: item.viewer_version_id, candidate_version_id: item.candidate_version_id,
        connection_id: item.request_id }} preview={item.preview} />}
    </>}
    {!waiting && <Button title={suggested ? 'Accept connection' : 'Accept invitation'} loading={change.isPending} disabled={change.isSuccess} onPress={() => change.mutate('accepted')} />}
    <Button title={waiting ? 'Cancel invitation' : suggested ? 'Decline suggestion' : 'Decline invitation'} variant="quiet" disabled={change.isPending || change.isSuccess}
      onPress={() => change.mutate(waiting ? 'revoked' : 'declined')} />
    {change.error && <Notice error>{errorMessage(change.error)}</Notice>}
  </Card>;
}

export function ConnectionInvitations({ active, embedded = false }: { active: boolean; embedded?: boolean }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [resumedAt, setResumedAt] = useState(Date.now());
  const [clock, setClock] = useState(Date.now());
  const visible = active && foreground;
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setForeground(state === 'active'); setResumedAt(Date.now());
    });
    return () => sub.remove();
  }, []);
  useEffect(() => { if (visible) setResumedAt(Date.now()); }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);
  const query = useQuery({ queryKey: ['connections', 'invitations', userId],
    queryFn: ({ signal }) => api<{ items: Connection[] }>('/v1/connections/invitations', { signal, expectedUserId: userId }),
    enabled: !!userId && visible, refetchInterval: 5_000, staleTime: 0, retry: false });
  const current = visible && !query.error && query.dataUpdatedAt >= resumedAt && clock-query.dataUpdatedAt < 20_000;
  const items = current && userId ? query.data?.items.filter(item => isPendingInvitation(item, userId, clock)) || [] : [];
  return <View style={{ gap: 16 }} accessibilityLabel="Connection invitations">
    {!embedded && <><Text style={s.cardTitle}>Suggestions and invitations</Text>
      <Body muted>A recommendation for either person appears here for both people. Matches contains connections you have both accepted.</Body></>}
    {query.error && <Notice error>Invitations could not be refreshed. {errorMessage(query.error)}</Notice>}
    {!current && query.isFetching && <ActivityIndicator accessibilityLabel="Loading invitations" />}
    {items.map(item => <InvitationCard key={item.request_id} item={item} userId={userId!} />)}
    {current && items.length === 0 && <Body muted>No pending suggestions.</Body>}
    <Button title="Refresh suggestions" icon="refresh-outline" variant="quiet" loading={query.isFetching}
      disabled={!userId || !visible} onPress={() => void query.refetch()} />
  </View>;
}
