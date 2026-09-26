import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Body, Button, Field, Notice, Toggle } from '@/components/ui';
import { useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useMe } from '@/features/profile/useMe';
import { matchingReadiness } from '@/features/profile/matchingReadiness';
import { api, errorMessage } from '@/lib/api';
import { useDiscovery } from './DiscoveryProvider';

export function DiscoveryControls() {
  const discovery = useDiscovery(); const me = useMe(); const client = useQueryClient();
  const radius = me.data?.profile.settings.discovery_radius_m ?? 3218.688;
  const [miles, setMiles] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [blockedControl, setBlockedControl] = useState<'Location' | 'Bluetooth' | null>(null);
  const value = miles ?? String(Math.round(radius / 1609.344 * 100) / 100);
  const number = Number(value);
  const readiness = me.data && matchingReadiness(me.data.current_version, me.data.profile.settings, me.data.preview, !!me.data.matching_consent);
  // Device activation follows the server's profile/consent prerequisites.
  // Candidate eligibility is checked separately by the matching service.
  const discoveryReady = !!me.data?.profile.current_profile_version_id && !!me.data.matching_consent && !me.isError;
  const missing = readiness?.checks.filter(check => !check.ready) ?? [];
  const needsProfile = !!readiness?.boundaryReview || missing.some(check => !['preview', 'consent'].includes(check.id));
  const needsSettings = missing.some(check => ['preview', 'consent'].includes(check.id));
  const save = useMutation({ mutationFn: () => api('/v1/settings', { method: 'PATCH', expectedUserId: me.data?.profile.user_id,
    body: { discovery_radius_m: number * 1609.344 } }), onMutate: () => discovery?.hide(), onSuccess: async () => {
    setMiles(null); await client.invalidateQueries({ queryKey: ['me'] }); await client.invalidateQueries({ queryKey: ['discoveries'] });
  } });
  if (!discovery) return null;
  const { presence, ble } = discovery;
  const bluetoothLive = ble.state.live && ble.state.scanning && ble.state.advertising;
  const bluetoothStarting = ble.busy || ble.state.status === 'starting';
  const bluetoothStatus = (ble.error ? 'Bluetooth needs attention. See the message below.' : '') || ble.state.message || (!ble.state.available ? 'Requires the SidebySide iPhone build.' : bluetoothLive
    ? 'Live · scanning and broadcasting while this app is open.'
    : bluetoothStarting ? 'Starting Bluetooth discovery…' : 'Off · tap to discover nearby SidebySide phones.');
  const locationStatus = presence.stage === 'locating' ? 'Finding your location… (up to 25 seconds)'
    : presence.stage === 'saving' ? 'Saving your location…'
    : presence.error ? 'Location needs attention. See the message below.'
    : presence.enabled && presence.lastUpdated ? 'On · location updates while this app is open.'
    : presence.enabled ? 'On · waiting for a fresh location.' : 'Off · tap to find people within your radius.';
  const needsPhoneSettings = ['unauthorized', 'poweredOff'].includes(ble.state.status)
    || /permission|precise location|location services|allow location/i.test(presence.error)
    || /allow bluetooth|turn bluetooth on|permissions/i.test(ble.error);
  const openSettings = async () => {
    setSettingsError('');
    try { await Linking.openSettings(); }
    catch { setSettingsError('Could not open settings. Open your phone’s Settings app and choose SidebySide.'); }
  };
  return <>
    {!me.data && !me.isError && <Body muted>Loading discovery settings…</Body>}
    {me.isError && <><Notice error>Could not load your discovery settings. {errorMessage(me.error)}</Notice>
      <Button title="Reload discovery settings" variant="secondary" loading={me.isFetching} onPress={() => void me.refetch()} /></>}
    {me.data && !discoveryReady && !me.isError && <Notice>To turn discovery on, save your profile and allow use of your approved details for matching in Settings.</Notice>}
    {!!blockedControl && !discoveryReady && <Notice error>{blockedControl} discovery is still off. Save your profile and allow matching in Settings, then tap the switch again. Nothing has been enabled.</Notice>}
    <Toggle title="Location discovery" description={locationStatus} value={presence.enabled} disabled={presence.busy || ((!me.data || me.isError) && !presence.enabled)} onValueChange={value => {
      if (value && !discoveryReady) { setBlockedControl('Location'); return; }
      setBlockedControl(null);
      discovery.hide(); void (value ? presence.enable() : presence.disable());
    }} />
    {!!presence.error && <><Notice error>{presence.error}</Notice>
      <Button title="Retry location" icon="refresh-outline" variant="secondary" loading={presence.busy} disabled={!me.data || me.isError} onPress={() => { if (!discoveryReady) setBlockedControl('Location'); else { setBlockedControl(null); void presence.enable(); } }} /></>}
    <Toggle title="Bluetooth discovery" description={bluetoothStatus} value={ble.state.live || bluetoothStarting} disabled={(!me.data || me.isError) && !ble.state.live && !bluetoothStarting} onValueChange={value => {
      if (value && !discoveryReady) { setBlockedControl('Bluetooth'); return; }
      setBlockedControl(null);
      discovery.hide(); void (value ? ble.start() : ble.stop());
    }} />
    {!!ble.error && <><Notice error>{ble.error}</Notice>
      {ble.state.available && !bluetoothLive && !bluetoothStarting && <Button title="Retry Bluetooth" icon="refresh-outline" variant="secondary" disabled={!me.data || me.isError} onPress={() => { if (!discoveryReady) setBlockedControl('Bluetooth'); else { setBlockedControl(null); void ble.start(); } }} />}</>}
    {Platform.OS !== 'web' && needsPhoneSettings && <Button title="Open phone settings" icon="settings-outline" variant="quiet" onPress={() => void openSettings()} />}
    {bluetoothLive && ble.encounters.length > 0 && <Notice>Nearby phone detected.</Notice>}
    {presence.enabled && <>
      {presence.lastUpdated && <Body muted>Location updated at {presence.lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Searching within {Math.round(radius / 1609.344 * 100) / 100} miles of your phone’s current position.</Body>}
      <Button title="Update my location" icon="locate-outline" variant="secondary" loading={presence.stage !== 'idle'} disabled={presence.busy} onPress={() => { discovery.hide(); void presence.refresh(); }} />
      <Field label="Location radius (0.1 to 2 miles)" keyboardType="decimal-pad" value={value} onChangeText={setMiles} />
      <Button title="Set radius" icon="checkmark" variant="secondary" loading={save.isPending} disabled={!Number.isFinite(number) || number < .1 || number > 2 || miles === null} onPress={() => save.mutate()} /></>}
    {me.data && !me.data.preview?.enabled && <Body muted>Your nearby preview is off, so you are not shown to other people.</Body>}
    {readiness && !readiness.ready && <>
      <Notice>For match suggestions: {missing.map(check => check.label.toLowerCase()).join('; ')}{missing.length > 0 ? '.' : ''}{readiness.boundaryReview ? ' Your topic boundaries are saved. Suggestions remain paused until the matching service can honor them.' : ''}</Notice>
      {needsProfile && <Button title="Review profile for discovery" icon="person-outline" variant="secondary" onPress={() => router.push('/(tabs)/profile')} />}
      {needsSettings && <Button title="Review matching and preview settings" icon="options-outline" variant="secondary" onPress={() => router.push('/(tabs)/settings')} />}
    </>}
    <Body muted>Bluetooth detects nearby signals, not precise position, direction or distance. The location radius only limits GPS discovery.</Body>
    {!ble.state.available && <Notice>Bluetooth discovery is available in the SidebySide iPhone build. Keep both phones’ apps open with Bluetooth discovery on.</Notice>}
    {!!save.error && <Notice error>{errorMessage(save.error)}</Notice>}
    {!!settingsError && <Notice error>{settingsError}</Notice>}
  </>;
}
