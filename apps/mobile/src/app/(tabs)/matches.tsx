import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Body, Brand, Button, Card, Chips, EmptyState, Heading, Label, Notice, Screen, s } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import type { Connection } from '@/lib/types';

function ConnectionCard({ item, userId }: { item: Connection; userId: string }) {
  const client = useQueryClient(); const [feedback, setFeedback] = useState(false);
  const ownDecision = item.requester_id === userId ? item.requester_decision : item.recipient_decision;
  const change = useMutation({ mutationFn: (decision: string) => api(`/v1/connections/${item.request_id}/decision`, { method: 'PUT', body: { decision } }), onSuccess: () => void client.invalidateQueries({ queryKey: ['connections'] }) });
  const rate = useMutation({ mutationFn: (useful: boolean) => api('/v1/feedback', { method: 'POST', body: { connection_id: item.request_id, conversation_useful: useful, would_talk_again: null } }), onSuccess: () => setFeedback(true) });
  const block = useMutation({ mutationFn: () => api(`/v1/blocks/${item.requester_id === userId ? item.recipient_id : item.requester_id}`, { method: 'POST' }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['connections'] }); void client.invalidateQueries({ queryKey: ['nearby'] }); } });
  const error = change.error || rate.error || block.error;
  return <Card><Text style={s.eyebrow}>{item.status.replaceAll('_', ' ')}</Text><Text style={s.cardTitle}>{item.preview?.display_name || 'Connection'}</Text><Chips values={item.preview?.interests || []} />
    {item.status === 'pending' && <><Body muted>{ownDecision === 'accepted' ? 'Your invitation is waiting for a reply.' : 'Someone would like to say hello. Accept to share the details you both approved.'}</Body>{ownDecision !== 'accepted' && <Button title="Accept invitation" loading={change.isPending} onPress={() => change.mutate('accepted')} />}<Button title={ownDecision === 'accepted' ? 'Cancel invitation' : 'Decline'} variant="quiet" disabled={change.isPending} onPress={() => change.mutate(ownDecision === 'accepted' ? 'revoked' : 'declined')} /></>}
    {item.status === 'accepted' && <><Body>You both said yes. Here’s what they chose to share.</Body>{item.shared_profile?.facts?.map((fact, i) => <View key={i} style={{ gap: 5 }}><Label>{fact.topic}</Label><Body muted>{fact.details}</Body></View>)}{item.shared_profile?.facts?.length === 0 && <Body muted>No additional details have been shared yet.</Body>}{feedback ? <Notice>Thanks. Your feedback stays private.</Notice> : <><Label>Was the conversation useful?</Label><View style={s.row}><Button title="Yes" variant="secondary" disabled={rate.isPending} onPress={() => rate.mutate(true)} /><Button title="Not this time" variant="quiet" disabled={rate.isPending} onPress={() => rate.mutate(false)} /></View></>}<Button title="End this connection" variant="quiet" disabled={change.isPending} onPress={() => change.mutate('revoked')} /></>}
    {['profile_changed', 'unavailable'].includes(item.status) && <Body muted>This connection is no longer current. New profile details require a new invitation.</Body>}
    {!['unavailable', 'revoked', 'declined'].includes(item.status) && <Button title="Block this person" variant="quiet" disabled={block.isPending} onPress={() => block.mutate()} />}
    {error && <Notice error>{errorMessage(error)}</Notice>}
  </Card>;
}
export default function Matches() {
  const { session } = useAuth(); const query = useQuery({ queryKey: ['connections', session?.user.id], queryFn: () => api<{ items: Connection[] }>('/v1/connections'), refetchInterval: 20_000 });
  return <Screen><Brand /><Heading eyebrow="From nearby to a new hello" title={"Good things\nstart with two."} subtitle="Your invitations and connections, all in one place." />{query.isPending && <ActivityIndicator />}{query.error && <><Notice error>{errorMessage(query.error)}</Notice><Button title="Try again" onPress={() => void query.refetch()} /></>}{query.data?.items.map(item => <ConnectionCard key={item.request_id} item={item} userId={session!.user.id} />)}{query.data?.items.length === 0 && <EmptyState icon="chatbubbles-outline" title="Your next conversation starts here." message="Say hello to someone in Nearby or Bluetooth. When you both accept, you’ll see the details you chose to share." />}</Screen>;
}
