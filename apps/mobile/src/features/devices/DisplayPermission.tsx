import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Notice, s } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

type Permission = { granted: boolean; peer_granted: boolean; revision: number; expires_at: string | null };
export function DisplayPermission({ requestId, userId, peerName, now, focused }: {
  requestId: string; userId: string; peerName: string; now: number; focused: boolean;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const queryKey = ['ar-display', userId, requestId];
  const state = useQuery({ queryKey, enabled: focused, refetchInterval: focused ? 5_000 : false,
    queryFn: ({ signal }) => api<Permission>(`/v1/devices/connections/${requestId}/display`, { signal, expectedUserId: userId }),
  });
  const granted = !state.isError && !!state.data?.granted && !!state.data.expires_at && Date.parse(state.data.expires_at) > now;
  async function change(value: boolean) {
    if (!state.data || busy) return;
    setBusy(true); setError('');
    try {
      await api(`/v1/devices/connections/${requestId}/display`, { method: 'PUT', expectedUserId: userId,
        body: { granted: value, revision: state.data.revision } });
    } catch (e) { setError(errorMessage(e)); }
    finally { await client.invalidateQueries({ queryKey }); setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    <Text style={s.body}>Allow my approved name and interests in AR with {peerName}</Text>
    <Switch accessibilityLabel={`Allow AR display with ${peerName}`} value={granted}
      disabled={!focused || busy || !state.data || state.isError} onValueChange={value => void change(value)} />
    <Text style={s.small}>{granted ? state.data?.peer_granted ? 'Both AR permissions are active.' : 'Waiting for their separate AR permission.' : 'AR display is off.'} Permission expires after 15 minutes.</Text>
    {(!!error || !!state.error) && <Notice error>{error || errorMessage(state.error)}</Notice>}
  </View>;
}
