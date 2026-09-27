import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { LocationMapState } from './types';

export function useLocationMap(userId: string, locationEnabled: boolean, bluetoothEnabled: boolean) {
  const [active, setActive] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useFocusEffect(useCallback(() => {
    setActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', value => setActive(value === 'active'));
    return () => { setActive(false); subscription.remove(); };
  }, []));
  const enabled = active && !!userId && (locationEnabled || bluetoothEnabled);
  const query = useQuery({
    queryKey: ['discovery-location-map', userId, locationEnabled, bluetoothEnabled],
    queryFn: ({ signal }) => api<LocationMapState>('/v1/discovery/location-map',
      { signal, expectedUserId: userId, timeoutMs: 12_000 }),
    enabled, gcTime: 0, staleTime: 0, retry: false, refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [enabled]);
  // Never retain another account's data, coordinates after disabling discovery,
  // background locations, or a stale map after a failed permissions recheck.
  return { ...query, data: enabled && !query.isError ? query.data : undefined, clock, enabled };
}
