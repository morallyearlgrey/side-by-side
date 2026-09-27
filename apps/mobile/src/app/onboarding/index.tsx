import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Brand, Button, Field, Notice, Screen, s } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import type { OnboardingSession } from '@/lib/types';
import { pendingReply, type PendingReply } from '@/features/onboarding/pendingReply';
import { isReadyForProfileReview } from '@/features/onboarding/reviewHandoff';
import { OnboardingIntro } from '@/features/onboarding/OnboardingIntro';
import { GlowPanel } from '@/components/GlowPanel';
import { GradientText } from '@/components/GradientText';
import { SpaceCanvas } from '@/components/SpaceCanvas';
import { useLunar } from '@/components/Lunar';
export default function Onboarding() {
  const { session } = useAuth(); const client = useQueryClient(); const [answer, setAnswer] = useState('');
  const { reducedMotion } = useLunar(); const [started, setStarted] = useState(false);
  const [pending, setPending] = useState<PendingReply | null>(null);
  const query = useQuery({ queryKey: ['onboarding', session?.user.id], queryFn: () => api<OnboardingSession>('/v1/onboarding'), enabled: !!session });
  const retry = pendingReply(query.data) ?? pending;
  const answersCount = query.data?.answers_count ?? query.data?.turns.filter(turn => turn.role === 'user').length ?? 0;
  const latestQuestion = [...(query.data?.turns || [])].reverse().find(turn => turn.role === 'assistant')?.content || 'What makes you YOU?';
  const send = useMutation({ mutationFn: ({ skip = false }: { skip?: boolean }) => {
    const message = retry ?? { message_id: Crypto.randomUUID(), content: skip ? '' : answer.trim(), skip };
    setPending(message);
    return api<OnboardingSession>('/v1/onboarding/messages', { method: 'POST', body: message, timeoutMs: 45_000 });
  }, onSuccess: data => {
    client.setQueryData(['onboarding', session?.user.id], data);
    const unanswered = pendingReply(data);
    setPending(unanswered);
    if (!unanswered) setAnswer('');
  } });
  if (!session) return <Redirect href="/auth" />;
  if (isReadyForProfileReview(query.data)) return <Redirect href="/onboarding/review" />;
  if (!started && answersCount === 0) return <OnboardingIntro onStart={() => setStarted(true)} />;
  return <Screen style={{ maxWidth: 730, gap: 20, paddingBottom: 80 }}><Brand compact />
    <View style={{ height: 155, overflow: 'hidden', marginHorizontal: -20 }}><SpaceCanvas scene="eclipse" height={300} reducedMotion={reducedMotion} /></View>
    <Text style={[s.eyebrow, { textAlign: 'center' }]}>COMET · YOUR CONVERSATION GUIDE</Text>
    <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>{Array.from({ length: query.data?.max_answers ?? 7 }, (_, index) => <View key={index} style={{ height: 3, borderRadius: 2, backgroundColor: index <= answersCount ? '#FF6D29' : '#594139', flex: 1, maxWidth: 62 }} />)}</View>
    {query.isPending && <ActivityIndicator />}{query.error && <><Notice error>{errorMessage(query.error)}</Notice><Button title="Try again" onPress={() => void query.refetch()} /></>}
    {query.data && <GlowPanel><View style={{ gap: 20 }}><Text style={s.eyebrow}>QUESTION {Math.min(answersCount + 1, query.data.max_answers ?? 7)} OF {query.data.max_answers ?? 7}</Text><GradientText size={36}>{retry ? 'Your answer is saved. Let’s continue.' : latestQuestion}</GradientText>
      {query.data.error && <Notice error>{query.data.error.message}</Notice>}
      {send.error && <Notice error>{errorMessage(send.error)}</Notice>}
      {!query.data.provider.available && <Notice>{query.data.provider.reason || 'Comet is temporarily unavailable. Your answers are saved.'}</Notice>}
      {retry ? <Button title="Retry Comet’s reply" loading={send.isPending} onPress={() => send.mutate({})} icon="refresh-outline" /> : <>
        <Field label="Your answer" placeholder="Tell Comet in your own words…" value={answer} onChangeText={setAnswer} multiline maxLength={5000} />
        <Button title="Next question" loading={send.isPending} disabled={!answer.trim()} onPress={() => send.mutate({})} icon="arrow-forward" />
      </>}
    </View></GlowPanel>}
    <Text style={[s.small, { textAlign: 'center' }]}>Your answers stay editable. You’ll approve the profile before it is used for matching.</Text>
  </Screen>;
}
