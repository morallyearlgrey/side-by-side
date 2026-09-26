import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Body, Button, Field, Notice, Toggle } from '@/components/ui';
import { useState } from 'react';
import { useMe } from '@/features/profile/useMe';
import { matchingReadiness } from '@/features/profile/matchingReadiness';
import { api, errorMessage } from '@/lib/api';
import { useDiscovery } from './DiscoveryProvider';

export function DiscoveryControls() {
  const discovery = useDiscovery(); const me = useMe(); const client = useQueryClient();
  const radius = me.data?.profile.settings.discovery_radius_m ?? 3218.688;
  const [miles, setMiles] = useState<string | null>(null);
  const value = miles ?? String(Math.round(radius / 1609.344 * 100) / 100);
  const number = Number(value);
  const ready = !!me.data && matchingReadiness(me.data.current_version, me.data.profile.settings, me.data.preview, !!me.data.matching_consent).ready;
  const save = useMutation({ mutationFn: () => api('/v1/settings', { method: 'PATCH', expectedUserId: me.data?.profile.user_id,
    body: { discovery_radius_m: number * 1609.344 } }), onMutate: () => discovery?.hide(), onSuccess: async () => {
    setMiles(null); await client.invalidateQueries({ queryKey: ['me'] }); await client.invalidateQueries({ queryKey: ['discoveries'] });
  } });
  if (!discovery) return null;
  const { presence, ble } = discovery;
  const bluetoothLive = ble.state.live && ble.state.scanning && ble.state.advertising;
  const bluetoothStarting = ble.busy || ble.state.status === 'starting' || ble.state.scanning || ble.state.advertising;
  const bluetoothStatus = !ble.state.available ? undefined : bluetoothLive
    ? 'Live · scanning and broadcasting while this app is open.'
    : bluetoothStarting ? 'Starting Bluetooth discovery…' : 'Idle · Bluetooth discovery is off.';
  return <>
    <Toggle title="Location discovery" value={presence.enabled} disabled={presence.busy || (!ready && !presence.enabled)} onValueChange={value => {
      discovery.hide(); void (value ? presence.enable() : presence.disable());
    }} />
    <Toggle title="Bluetooth discovery" description={bluetoothStatus} value={ble.state.live || ble.state.status === 'starting'} disabled={ble.busy || (!ready && !ble.state.live)} onValueChange={value => {
      discovery.hide(); void (value ? ble.start() : ble.stop());
    }} />
    {bluetoothLive && ble.encounters.length > 0 && <Notice>Nearby phone detected.</Notice>}
    {presence.enabled && <><Field label="Location radius (0.1 to 2 miles)" keyboardType="decimal-pad" value={value} onChangeText={setMiles} />
      <Button title="Set radius" icon="checkmark" variant="secondary" loading={save.isPending} disabled={!Number.isFinite(number) || number < .1 || number > 2 || miles === null} onPress={() => save.mutate()} /></>}
    <Body muted>Bluetooth detects nearby signals, not precise position, direction or distance. The location radius only limits GPS discovery.</Body>
    {!ble.state.available && <Notice>Phone Bluetooth discovery requires the supported native build.</Notice>}
    {!!(presence.error || ble.error || save.error) && <Notice error>{presence.error || ble.error || errorMessage(save.error)}</Notice>}
  </>;
}
