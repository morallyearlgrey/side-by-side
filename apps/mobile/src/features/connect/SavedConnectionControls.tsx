import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Body, Button, Notice, s } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Preference } from '@/lib/types';

export function SavedConnectionControls({ requestId, userId, preference, showPreference = true }: {
  requestId: string; userId: string; preference: Preference | null; showPreference?: boolean;
}) {
  const client = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rate = useMutation({ mutationFn: (value: Preference) => api<{ preference: Preference }>(
    `/v1/connections/${requestId}/preference`, { method: 'PUT', expectedUserId: userId, body: { preference: value } }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['connections'] }); } });
  const remove = useMutation({ mutationFn: () => api<{ deleted: number }>(`/v1/connections/${requestId}`, {
    method: 'DELETE', expectedUserId: userId }),
    onSuccess: () => { setConfirmDelete(false); void client.invalidateQueries({ queryKey: ['connections'] });
      void client.invalidateQueries({ queryKey: ['discoveries'] }); } });
  const selected = rate.data?.preference || preference;
  return <View style={{ gap: 12 }}>
    {showPreference && <View style={[s.row, { flexWrap: 'wrap' }]}>
      <Button title={selected === 'liked' ? 'Liked' : 'Like'} variant="secondary" icon="thumbs-up-outline"
        disabled={rate.isPending || remove.isPending} onPress={() => rate.mutate('liked')} />
      <Button title={selected === 'disliked' ? 'Disliked' : 'Dislike'} variant="quiet" icon="thumbs-down-outline"
        disabled={rate.isPending || remove.isPending} onPress={() => rate.mutate('disliked')} />
    </View>}
    {!confirmDelete ? <Button title="Delete saved connection" variant="quiet" icon="trash-outline"
      disabled={remove.isPending} onPress={() => setConfirmDelete(true)} />
      : <View style={{ gap: 10 }}>
        <Body muted>Delete this connection for both people? It will leave Matches and remove any meetup sharing. This cannot be undone.</Body>
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          <Button title="Cancel" variant="quiet" disabled={remove.isPending} onPress={() => setConfirmDelete(false)} />
          <Button title="Delete for both" variant="danger" loading={remove.isPending} onPress={() => remove.mutate()} />
        </View>
      </View>}
    {rate.error && <Notice error>{errorMessage(rate.error)}</Notice>}
    {remove.error && <Notice error>{errorMessage(remove.error)}</Notice>}
  </View>;
}
