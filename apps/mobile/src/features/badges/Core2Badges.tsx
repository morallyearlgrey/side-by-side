import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Body, Button, Card, Field, Label, Notice, s } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { badgeStatus, type BadgeStatus } from './badgeStatus';

type Badge = {
  device_id: string;
  label: string;
  reported_state: 'paused' | 'available';
  last_sequence: number | null;
  last_seen_at: string | null;
  lease_expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  effective_state: 'paused' | 'available' | 'offline' | 'revoked';
};
type BadgeList = { badges: Badge[] };
type IssuedToken = { deviceId: string; token: string };
const stateLabels: Record<BadgeStatus, string> = {
  available: 'Available', paused: 'Paused', offline: 'Offline', revoked: 'Revoked', unavailable: 'Unavailable — refresh failed',
};

/** This hardware status control never changes phone discovery or matching consent. */
export function Core2Badges({ userId }: { userId: string }) {
  const client = useQueryClient();
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [label, setLabel] = useState('My Core2 badge');
  const [issuedToken, setIssuedToken] = useState<IssuedToken | null>(null);
  const [registering, setRegistering] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const viewGeneration = useRef(0);
  const operationInFlight = useRef(false);
  const queryKey = ['core2-badges', userId];
  const badges = useQuery({
    queryKey,
    queryFn: ({ signal }) => api<BadgeList>('/v1/badges', { signal, expectedUserId: userId }),
    enabled: focused,
    refetchInterval: focused ? 15_000 : false,
    refetchIntervalInBackground: false,
  });

  useFocusEffect(useCallback(() => {
    ++viewGeneration.current;
    setFocused(!!userId);
    setError('');
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(timer);
      ++viewGeneration.current;
      setFocused(false);
      setIssuedToken(null);
      setRegistering(false);
      setRevoking(null);
    };
  }, [userId]));

  async function register() {
    if (operationInFlight.current || issuedToken || !focused || !label.trim()) return;
    operationInFlight.current = true;
    const generation = viewGeneration.current;
    setRegistering(true);
    setError('');
    try {
      // A mutation cache must never retain this one-time credential.
      const result = await api<{ badge: Badge; device_token: string }>('/v1/badges', {
        method: 'POST', body: { label: label.trim() }, expectedUserId: userId,
      });
      if (viewGeneration.current !== generation) return;
      setIssuedToken({ deviceId: result.badge.device_id, token: result.device_token });
      await client.invalidateQueries({ queryKey: ['core2-badges', userId] });
    } catch (e) {
      if (viewGeneration.current === generation) setError(errorMessage(e));
    } finally {
      operationInFlight.current = false;
      if (viewGeneration.current === generation) setRegistering(false);
    }
  }

  async function revoke(deviceId: string) {
    if (operationInFlight.current || !focused) return;
    operationInFlight.current = true;
    const generation = viewGeneration.current;
    setRevoking(deviceId);
    setError('');
    try {
      await api<{ badge: Badge }>(`/v1/badges/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE', expectedUserId: userId,
      });
      if (viewGeneration.current !== generation) return;
      setIssuedToken(current => current?.deviceId === deviceId ? null : current);
      await client.invalidateQueries({ queryKey: ['core2-badges', userId] });
    } catch (e) {
      if (viewGeneration.current === generation) setError(errorMessage(e));
    } finally {
      operationInFlight.current = false;
      if (viewGeneration.current === generation) setRevoking(null);
    }
  }

  return <Card>
    <Text style={s.eyebrow}>Hardware prototype</Text>
    <Text style={s.cardTitle}>Your Core2 badge</Text>
    <Body muted>See the status reported by your badge over Wi-Fi. Phone Bluetooth discovery has its own controls above.</Body>
    <Text style={s.small}>The badge becomes offline after 45 seconds without an update. This view refreshes every 15 seconds while Settings is open.</Text>
    {badges.isPending && focused && <ActivityIndicator accessibilityLabel="Loading Core2 badges" />}
    {badges.error && <Notice error>{errorMessage(badges.error)}</Notice>}
    {badges.data?.badges.length === 0 && <Body muted>No Core2 badges registered yet.</Body>}
    {badges.data?.badges.map(badge => <View key={badge.device_id} style={{ gap: 8 }}>
      <Label>{badge.label}</Label>
      <Text style={s.body}>Status: {stateLabels[badgeStatus(badge, now, badges.isError)]}</Text>
      <Text style={s.small}>{badge.last_seen_at ? `Last seen ${new Date(badge.last_seen_at).toLocaleString()}` : 'Waiting for its first Wi-Fi update.'}</Text>
      {!badge.revoked_at && badge.effective_state !== 'revoked' && <Button
        title={`Revoke ${badge.label}`} variant="quiet" loading={revoking === badge.device_id}
        disabled={registering || !!revoking} onPress={() => void revoke(badge.device_id)}
      />}
    </View>)}
    <Button title="Refresh badge status" variant="quiet" loading={badges.isFetching} onPress={() => void badges.refetch()} />
    <Field label="Badge name" value={label} onChangeText={setLabel} maxLength={64} autoCapitalize="sentences" />
    <Button title="Register Core2 badge" variant="secondary" loading={registering}
      disabled={!label.trim() || !!issuedToken || !!revoking} onPress={() => void register()} />
    {!!error && <Notice error>{error}</Notice>}
    {issuedToken && <View style={{ gap: 12 }}>
      <Label>Save your device token</Label>
      <Body muted>Copy this token into the firmware’s ignored badge_config.h file before leaving Settings. It is shown only here and cannot be retrieved later. Keep it out of Git and screenshots.</Body>
      <Text selectable accessibilityLabel="One-time Core2 device token" style={s.input}>{issuedToken.token}</Text>
      <Button title="I saved the token — hide it" variant="secondary" onPress={() => setIssuedToken(null)} />
    </View>}
    <Text style={s.small}>If you lose a token, revoke that badge and register it again. Configure the badge’s Wi-Fi and API address in the firmware before testing.</Text>
  </Card>;
}
