import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Notice, s } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { MatchTarget, Preference } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthProvider';

export function MatchPreference({ target, preference, onSaved }: { target: MatchTarget; preference: Preference | null; onSaved?: () => void }) {
  const { session } = useAuth(); const client = useQueryClient();
  const save = useMutation({ mutationFn: (value: Preference) => api<{ preference: Preference }>('/v1/match-preferences', {
    method: 'PUT', expectedUserId: session?.user.id, body: { ...target, preference: value } }),
    onSuccess: async () => { onSaved?.(); await client.invalidateQueries({ queryKey: ['connections'] }); await client.invalidateQueries({ queryKey: ['discoveries'] }); } });
  const selected = save.data?.preference || preference;
  return <><View style={[s.row, { flexWrap: 'wrap' }]}>
    <Button title={selected === 'liked' ? 'Liked' : 'Like'} icon={selected === 'liked' ? 'thumbs-up' : 'thumbs-up-outline'} variant="secondary" disabled={save.isPending} onPress={() => save.mutate('liked')} />
    <Button title={selected === 'disliked' ? 'Disliked' : 'Dislike'} icon={selected === 'disliked' ? 'thumbs-down' : 'thumbs-down-outline'} variant="quiet" disabled={save.isPending} onPress={() => save.mutate('disliked')} />
  </View>{save.error && <Notice error>{errorMessage(save.error)}</Notice>}</>;
}
