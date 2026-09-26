import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Body, Button, Card, Chips, Notice, s } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Preview } from '@/lib/types';
import { colors } from '@/lib/theme';
import { ConversationDetails } from '@/features/bluetooth/ConversationDetails';

export function PersonCard({ userId, preview, rank, mode = 'nearby', canInvite = true }: { userId: string; preview: Preview; rank?: number; mode?: 'nearby' | 'ble'; canInvite?: boolean }) {
  const client = useQueryClient(); const [sent, setSent] = useState(false);
  const invite = useMutation({ mutationFn: () => api('/v1/connections', { method: 'POST', body: { candidate_id: userId, mode } }), onSuccess: () => { setSent(true); void client.invalidateQueries({ queryKey: ['connections'] }); } });
  return <Card><View style={s.row}><View style={{ width: 54, height: 54, borderRadius: 20, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24, color: colors.violet, fontWeight: '500' }}>{preview.display_name.slice(0, 1).toUpperCase() || 'S'}</Text></View><View style={{ flex: 1, gap: 4 }}><Text style={s.cardTitle}>{preview.display_name || 'Someone nearby'}</Text><Text style={s.small}>{mode === 'ble' ? 'Discovered over Bluetooth' : 'Within two miles'}</Text></View>{rank !== undefined && <Text style={[s.eyebrow, { fontSize: 13 }]}>#{rank}</Text>}</View>
    <Chips values={preview.interests || []} />
    {mode === 'ble' && <ConversationDetails candidateId={userId} />}
    {invite.error && <Notice error>{errorMessage(invite.error)}</Notice>}
    {sent ? <Body muted>Invitation sent. You can follow it in Matches.</Body> : <Button title={canInvite ? 'Say hello' : 'Checking your match…'} variant="secondary" icon="arrow-forward" loading={invite.isPending} disabled={!canInvite} onPress={() => invite.mutate()} />}
  </Card>;
}
