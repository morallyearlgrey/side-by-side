import { ActivityIndicator } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand, Button, Heading, Notice, Screen } from '@/components/ui';
import { ProfileForm } from '@/features/profile/ProfileForm';
import { useMe } from '@/features/profile/useMe';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import type { OnboardingSession, ReviewRequest } from '@/lib/types';
export default function Review() {
  const { session } = useAuth(); const me = useMe(); const client = useQueryClient();
  const query = useQuery({ queryKey: ['onboarding', session?.user.id], queryFn: () => api<OnboardingSession>('/v1/onboarding'), enabled: !!session });
  const save = useMutation({ mutationFn: (body: ReviewRequest) => api('/v1/onboarding/review', { method: 'POST', body }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['me'] }); router.replace('/onboarding/permissions'); } });
  if (!session) return <Redirect href="/auth" />;
  return <Screen><Brand /><Heading eyebrow="Your words. Your choice." title={"Does this\nsound like you?"} subtitle="Keep what feels right. Add what’s missing. Choose what you’d like to share." />{(me.isPending || query.isPending) && <ActivityIndicator />}{(me.error || query.error) && <Notice error>{errorMessage(me.error || query.error)}</Notice>}
    {me.data && query.data && <ProfileForm initialDraft={query.data.draft} initialSettings={me.data.profile.settings} initialPreview={me.data.preview} initialConsent={me.data.matching_consent} saving={save.isPending} onSave={data => save.mutate(data)} error={save.error ? errorMessage(save.error) : undefined} onboarding />}
    <Button title="Back to our conversation" variant="quiet" onPress={() => router.back()} />
  </Screen>;
}
