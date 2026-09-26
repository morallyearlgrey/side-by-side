import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Body, Button, Field, Label, Notice, Toggle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Preview } from '@/lib/types';
import { splitList } from './ProfileForm';
import { useDiscovery } from '@/features/connect/DiscoveryProvider';

export function PreviewSettings({ preview, userId }: { preview: Preview | null; userId: string }) {
  const [draft, setDraft] = useState(preview || { enabled: false, display_name: '', interests: [] });
  const [interests, setInterests] = useState(draft.interests.join(', '));
  const client = useQueryClient(); const discovery = useDiscovery();
  const save = useMutation({ mutationFn: () => api('/v1/profile/preview', { method: 'PUT', expectedUserId: userId,
    body: { ...draft, interests: splitList(interests).slice(0, 8) } }), onMutate: () => discovery?.hide(), onSuccess: async () => {
    client.removeQueries({ queryKey: ['descriptions'] }); client.removeQueries({ queryKey: ['discoveries'] });
    await client.invalidateQueries({ queryKey: ['me'] }); await client.invalidateQueries({ queryKey: ['connections'] });
  } });
  return <><Label>Preview sharing</Label><Body muted>People can see this preview before you both accept. Sharing approved facts after acceptance is controlled in Profile.</Body>
    <Toggle title="Show my preview" value={!!draft.enabled} onValueChange={enabled => setDraft({ ...draft, enabled })} />
    <Field label="Preview name" maxLength={80} value={draft.display_name} onChangeText={display_name => setDraft({ ...draft, display_name })} />
    <Field label="Preview interests (up to 8, separated by commas)" value={interests} onChangeText={setInterests} />
    <Button title="Save preview" icon="checkmark" loading={save.isPending} disabled={!!draft.enabled && !draft.display_name.trim()} onPress={() => save.mutate()} />
    {save.error && <Notice error>{errorMessage(save.error)}</Notice>}
  </>;
}
