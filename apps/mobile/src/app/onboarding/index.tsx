import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Brand, Button, Card, Field, Heading, Notice, Screen, s } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import type { OnboardingSession } from '@/lib/types';
import { colors } from '@/lib/theme';
import { pendingReply, type PendingReply } from '@/features/onboarding/pendingReply';
import { isReadyForProfileReview } from '@/features/onboarding/reviewHandoff';
export default function Onboarding() {
  const { session } = useAuth(); const client = useQueryClient(); const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState<PendingReply | null>(null);
  const query = useQuery({ queryKey: ['onboarding', session?.user.id], queryFn: () => api<OnboardingSession>('/v1/onboarding'), enabled: !!session });
  const retry = pendingReply(query.data) ?? pending;
  const answersCount = query.data?.answers_count ?? query.data?.turns.filter(turn => turn.role === 'user').length ?? 0;
  const send = useMutation({ mutationFn: ({ skip = false }: { skip?: boolean }) => {
    const message = retry ?? { message_id: Crypto.randomUUID(), content: skip ? '' : answer.trim(), skip };
    setPending(message);
    return api<OnboardingSession>('/v1/onboarding/messages', { method: 'POST', body: message, timeoutMs: 120_000 });
  }, onSuccess: data => {
    client.setQueryData(['onboarding', session?.user.id], data);
    const unanswered = pendingReply(data);
    setPending(unanswered);
    if (!unanswered) setAnswer('');
  } });
  if (!session) return <Redirect href="/auth" />;
  if (isReadyForProfileReview(query.data)) return <Redirect href="/onboarding/review" />;
  return <Screen><Brand /><Heading eyebrow="A conversation, not a questionnaire" title={"Let’s start\nwith you."} subtitle="Share a little, or a lot. You’ll review everything before it becomes part of your profile." />
    {query.data && <Text accessibilityLiveRegion="polite" style={s.small}>{answersCount} of {query.data.max_answers ?? 7} answers maximum. Review whenever you are ready.</Text>}
    {query.isPending && <ActivityIndicator />}{query.error && <><Notice error>{errorMessage(query.error)}</Notice><Button title="Try again" onPress={() => void query.refetch()} /></>}
    {(query.data?.turns || []).map((turn, i) => <View key={turn.id || i} style={{ alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '94%', padding: 18, borderRadius: 8, borderWidth: 1, borderColor: turn.role === 'assistant' ? colors.line : colors.actionBorder, backgroundColor: turn.role === 'assistant' ? colors.surface : colors.action }}><Text style={{ color: colors.ink, fontSize: 16, lineHeight: 25 }}>{turn.content}</Text></View>)}
    {query.data && !query.data.provider.available && <Notice>{query.data.provider.reason || 'Your conversation guide is temporarily unavailable. Your answers are saved.'}</Notice>}
    {query.data && <Card>
      {query.data.error && <Notice error>{query.data.error.message}</Notice>}
      {send.error && <Notice error>{errorMessage(send.error)}</Notice>}
      {retry ? <><Notice>Your last answer is waiting for a reply. Retry to continue, or review your profile below.</Notice><Button title="Retry reply" loading={send.isPending} onPress={() => send.mutate({})} /></> : <>
        <Field label="Your answer" placeholder="The things I keep coming back to…" value={answer} onChangeText={setAnswer} multiline maxLength={5000} />
        <Button title="Continue the conversation" loading={send.isPending} disabled={!answer.trim()} onPress={() => send.mutate({})} icon="arrow-up" />
        <Button title="Skip this question" variant="quiet" disabled={send.isPending} onPress={() => send.mutate({ skip: true })} />
      </>}
    </Card>}
    {query.data && <><Button title="Review my profile" variant="secondary" disabled={send.isPending} onPress={() => router.push('/onboarding/review')} /><Text style={[s.small, { textAlign: 'center' }]}>You can add details and make changes anytime.</Text></>}
  </Screen>;
}
