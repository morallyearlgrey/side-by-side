import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Body, Button, Card, Notice, s } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { headsetStatus, type Headset } from './deviceStatus';
import { DisplayPermission } from './DisplayPermission';
import type { Connection } from '@/lib/types';

type Pairing = { pairing_id: string; pairing_token: string; expires_at: string; kind: 'quest' | 'core2' };
const labels = {
  offline: 'Offline', revoked: 'Unlinked', connected_unknown: 'Connected, wearing status unknown',
  connected_not_worn: 'Connected, not worn', ar_unavailable: 'Worn, AR paused or unavailable', ar_ready: 'AR ready',
};

export function OptionalDevices({ userId, signingOut = false }: { userId: string; signingOut?: boolean }) {
  const client = useQueryClient();
  const generation = useRef(0);
  const active = useRef(new Set<string>());
  const busy = useRef(false);
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [enabled, setEnabled] = useState<string[]>([]);
  const queryKey = ['headsets', userId];
  const headsets = useQuery({ queryKey,
    queryFn: ({ signal }) => api<{ headsets: Headset[] }>('/v1/devices/headsets', { signal, expectedUserId: userId }),
    enabled: focused, refetchInterval: focused ? 5_000 : false, refetchIntervalInBackground: false,
  });
  const connections = useQuery({ queryKey: ['device-connections', userId], enabled: focused,
    queryFn: ({ signal }) => api<{ items: Connection[] }>('/v1/connections', { signal, expectedUserId: userId }),
    refetchInterval: focused ? 5_000 : false, refetchIntervalInBackground: false,
  });

  useFocusEffect(useCallback(() => {
    const epoch = ++generation.current;
    if (signingOut) { setFocused(false); return; }
    setFocused(true);
    setError('');
    let renewing = false;
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    const keepalive = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      try {
        for (const id of active.current) {
          if (generation.current !== epoch) break;
          await api(`/v1/devices/headsets/${id}/lease`, { method: 'PUT', expectedUserId: userId, timeoutMs: 5_000 });
        }
      } catch (e) {
        if (generation.current === epoch) setError(errorMessage(e));
      } finally { renewing = false; }
    }, 10_000);
    return () => {
      ++generation.current;
      clearInterval(clock);
      clearInterval(keepalive);
      active.current.clear();
      setEnabled([]);
      setFocused(false);
      setPairing(null);
    };
  }, [userId, signingOut]));

  async function operate(action: () => Promise<void>) {
    if (busy.current || !focused) return;
    busy.current = true;
    setWorking(true);
    setError('');
    const epoch = generation.current;
    try { await action(); }
    catch (e) { if (epoch === generation.current) setError(errorMessage(e)); }
    finally { busy.current = false; if (epoch === generation.current) setWorking(false); }
  }

  async function approve(kind: Pairing['kind']) {
    const epoch = generation.current;
    const result = await api<Pairing>('/v1/devices/pairings', { method: 'POST', expectedUserId: userId,
      body: { kind, label: kind === 'quest' ? 'Meta Quest 3' : 'Core2 Muse AI Charm' } });
    if (generation.current === epoch) setPairing(result);
    else await api(`/v1/devices/pairings/${result.pairing_id}`, { method: 'DELETE', expectedUserId: userId });
  }

  async function enable(id: string) {
    const epoch = generation.current;
    await api(`/v1/devices/headsets/${id}/lease`, { method: 'PUT', expectedUserId: userId });
    if (generation.current !== epoch) return;
    active.current.add(id);
    setEnabled([...active.current]);
    await client.invalidateQueries({ queryKey });
  }

  async function unlink(id: string) {
    active.current.delete(id);
    setEnabled([...active.current]);
    await api(`/v1/devices/headsets/${id}`, { method: 'DELETE', expectedUserId: userId });
    await client.invalidateQueries({ queryKey });
  }

  return <Card>
    <Text style={s.cardTitle}>Optional devices</Text>
    <Body muted>Link your headset or charm to this account. Linking does not share your profile or change matching consent.</Body>
    {!connections.isError && connections.data?.items.filter(item => item.status === 'accepted').map(item =>
      <DisplayPermission key={`${userId}-${item.request_id}`} requestId={item.request_id} userId={userId}
        peerName={item.preview?.display_name || 'this connection'} now={now} focused={focused} />)}
    {headsets.data?.headsets.map(device => <View key={device.device_id} style={{ gap: 8 }}>
      <Text style={s.body}>{device.label}: {labels[headsetStatus(device, now, headsets.isError)]}</Text>
      {!device.revoked_at && <>
        <Button title={enabled.includes(device.device_id) ? 'Headset session enabled' : 'Enable headset session'}
          icon="glasses-outline" variant="secondary" disabled={working || enabled.includes(device.device_id)}
          onPress={() => void operate(() => enable(device.device_id))} />
        <Button title="Unlink headset" icon="close-outline" variant="quiet" disabled={working}
          onPress={() => void operate(() => unlink(device.device_id))} />
      </>}
    </View>)}
    <Body muted>Keep this view open during a headset session. Its authorization expires within 30 seconds after this view closes. Wearing and AR readiness come from the headset.</Body>
    <Button title="Approve Quest pairing" icon="glasses-outline" variant="secondary" disabled={working || !!pairing}
      onPress={() => void operate(() => approve('quest'))} />
    <Button title="Approve charm pairing" icon="hardware-chip-outline" variant="secondary" disabled={working || !!pairing}
      onPress={() => void operate(() => approve('core2'))} />
    {pairing && <View style={{ gap: 8 }}>
      <Text style={s.small}>{Date.parse(pairing.expires_at) > now ? 'Private USB setup approval. Single use; expires in three minutes.' : 'Pairing approval expired.'}</Text>
      {Date.parse(pairing.expires_at) > now && <Text selectable style={s.input}>{pairing.pairing_token}</Text>}
      <Button title="Cancel pairing" variant="quiet" disabled={working} onPress={() => void operate(async () => {
        await api(`/v1/devices/pairings/${pairing.pairing_id}`, { method: 'DELETE', expectedUserId: userId });
        setPairing(null);
      })} />
    </View>}
    {(!!error || !!headsets.error) && <Notice error>{error || errorMessage(headsets.error)}</Notice>}
  </Card>;
}
