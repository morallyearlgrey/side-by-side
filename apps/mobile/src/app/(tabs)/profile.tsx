import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Brand, Button, Notice, Screen } from '@/components/ui';
import { ProfileForm } from '@/features/profile/ProfileForm';
import { ProfileHero } from '@/features/profile/ProfileHero';
import { useMe } from '@/features/profile/useMe';
import { api, errorMessage } from '@/lib/api';
import type { ReviewRequest } from '@/lib/types';

export default function Profile() {
  const me = useMe(); const client = useQueryClient();
  const [saved, setSaved] = useState(false);
  const owner = me.data?.profile.user_id;
  const save = useMutation({ mutationFn: (body: ReviewRequest) => api('/v1/profile', { method: 'PATCH', body, expectedUserId: owner }), onSuccess: async () => {
    setSaved(true);
    client.removeQueries({ queryKey: ['descriptions'] });
    client.removeQueries({ queryKey: ['discoveries'] });
    await client.invalidateQueries({ queryKey: ['me'] });
    await client.invalidateQueries({ queryKey: ['connections'] });
  } });
  const version = me.data?.current_version;
  return <Screen><Brand /><ProfileHero name={me.data?.profile.display_name} />
    {me.isPending && <ActivityIndicator />}
    {me.error && <><Notice error>{errorMessage(me.error)}</Notice><Button title="Try again" onPress={() => void me.refetch()} /></>}
    {version && <>
      {saved && <Notice>Your approved profile details are saved.</Notice>}
      <ProfileForm key={version.profile_version_id} initialDraft={version} initialSettings={me.data!.profile.settings} initialPreview={me.data!.preview} showPreview={false} saving={save.isPending} onSave={body => { setSaved(false); save.mutate(body); }} error={save.error ? errorMessage(save.error) : undefined} />
    </>}
  </Screen>;
}
