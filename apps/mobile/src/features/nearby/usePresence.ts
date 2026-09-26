import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/features/profile/useMe';
import { useQueryClient } from '@tanstack/react-query';

export function usePresence() {
  const me = useMe(); const client = useQueryClient(); const enabled = !!me.data?.profile.discoverable;
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const publish = useCallback(async (point: Location.LocationObject) => {
    if (point.coords.accuracy === null || point.coords.accuracy > 250) throw new Error('Your location is not precise enough yet. Try again in a moment.');
    await api('/v1/presence', { method: 'PUT', body: { latitude: point.coords.latitude, longitude: point.coords.longitude, accuracy_m: point.coords.accuracy, observed_at: new Date(point.timestamp).toISOString() } });
    setLastUpdated(new Date()); setError('');
  }, []);
  const refresh = useCallback(async () => {
    if (!enabled || AppState.currentState !== 'active') return;
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') { setError('Allow location access to discover people nearby.'); return; }
    await publish(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  }, [enabled, publish]);
  const enable = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Location access is off. You can enable it later in your phone’s settings.');
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await api('/v1/settings', { method: 'PATCH', body: { discoverable: true } });
      await publish(point); await client.invalidateQueries({ queryKey: ['me'] }); await client.invalidateQueries({ queryKey: ['nearby'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }, [publish, client]);
  const disable = useCallback(async () => {
    setBusy(true); setError('');
    try { await api('/v1/settings', { method: 'PATCH', body: { discoverable: false } }); await client.invalidateQueries({ queryKey: ['me'] }); client.removeQueries({ queryKey: ['nearby'] }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }, [client]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false; let watch: Location.LocationSubscription | undefined;
    const begin = async () => {
      watch?.remove();
      if (AppState.currentState !== 'active' || cancelled) return;
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') { setError('Allow location access to discover people nearby.'); return; }
        await refresh();
        const subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 60_000 }, point => { if (!cancelled) void publish(point).catch(e => setError(errorMessage(e))); });
        if (cancelled) subscription.remove(); else watch = subscription;
      } catch (e) { if (!cancelled) setError(errorMessage(e)); }
    };
    void begin(); const interval = setInterval(() => { void refresh().catch(e => setError(errorMessage(e))); }, 120_000);
    const sub = AppState.addEventListener('change', value => { if (value === 'active') void begin(); else watch?.remove(); });
    return () => { cancelled = true; watch?.remove(); clearInterval(interval); sub.remove(); };
  }, [enabled, refresh, publish]);
  return { enabled, error, busy, lastUpdated, enable, disable, refresh };
}
