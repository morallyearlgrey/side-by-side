import { ActivityIndicator, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand, Button, Notice, Screen } from '@/components/ui';
import { ProfileForm } from '@/features/profile/ProfileForm';
import { useMe } from '@/features/profile/useMe';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import type { OnboardingSession, ReviewRequest } from '@/lib/types';
import { isReadyForProfileReview } from '@/features/onboarding/reviewHandoff';
import { GradientText } from '@/components/GradientText';
import { GlowPanel } from '@/components/GlowPanel';
export default function Review() {
  const { session } = useAuth(); const me = useMe(); const client = useQueryClient();
  const query = useQuery({ queryKey: ['onboarding', session?.user.id], queryFn: () => api<OnboardingSession>('/v1/onboarding'), enabled: !!session });
  const save = useMutation({ mutationFn: (body: ReviewRequest) => api('/v1/onboarding/review', { method: 'POST', body, expectedUserId: session?.user.id }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['me'] }); router.replace({ pathname: '/(tabs)/settings', params: { onboarding: 'permissions' } }); } });
  if (!session) return <Redirect href="/auth" />;
  return <Screen><Brand /><GlowPanel><View style={{ gap: 14 }}><Text style={{ color: '#FCB187', letterSpacing: 2, fontSize: 11 }}>YOUR WORDS · YOUR CHOICE</Text><GradientText size={39}>Your profile, in your words.</GradientText><Text style={{ color: '#BABABA', fontSize: 16, lineHeight: 24 }}>Edit your details, approve what feels right, and choose what you’d like to share. Save your profile below to continue.</Text></View></GlowPanel>{(me.isPending || query.isPending) && <ActivityIndicator />}{(me.error || query.error) && <Notice error>{errorMessage(me.error || query.error)}</Notice>}
    {(query.data?.draft_incomplete || query.data?.error) && <Notice>Your answers are saved, but the guide could not include your latest answer in this draft. Add any missing detail before saving.</Notice>}
    {me.data && query.data && <ProfileForm initialDraft={query.data.draft} initialSettings={me.data.profile.settings} initialPreview={me.data.preview} saving={save.isPending} onSave={data => save.mutate(data)} error={save.error ? errorMessage(save.error) : undefined} onboarding />}
    {query.data && !isReadyForProfileReview(query.data) && <Button title="Back to our conversation" variant="quiet" onPress={() => router.back()} />}
  </Screen>;
}
