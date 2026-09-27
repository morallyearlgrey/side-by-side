import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { LocationMapState } from './types';
import { currentMapPeerIds, loadAcceptedMapPeers, mapReadIsCurrent } from './acceptedConnections';

export function useLocationMap(userId: string, locationEnabled: boolean, bluetoothEnabled: boolean) {
  const [active, setActive] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [resumedAt, setResumedAt] = useState(Date.now());
  useFocusEffect(useCallback(() => {
    const resume = (value: string) => {
      setResumedAt(Date.now()); setClock(Date.now());
      setActive(value === 'active' && !!userId && (locationEnabled || bluetoothEnabled));
    };
    resume(AppState.currentState);
    const subscription = AppState.addEventListener('change', resume);
    return () => { setActive(false); subscription.remove(); };
  }, [userId, locationEnabled, bluetoothEnabled]));
  const enabled = active && !!userId && (locationEnabled || bluetoothEnabled);
  const query = useQuery({
    queryKey: ['discovery-location-map', userId, locationEnabled, bluetoothEnabled],
    queryFn: ({ signal }) => api<LocationMapState>('/v1/discovery/location-map',
      { signal, expectedUserId: userId, timeoutMs: 12_000 }),
    enabled, gcTime: 0, staleTime: 0, retry: false, refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const connections = useQuery({
    queryKey: ['connections', 'location-map', userId],
    queryFn: ({ signal }) => loadAcceptedMapPeers(userId, signal),
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
  const now = Math.max(clock, Date.now());
  const current = mapReadIsCurrent(enabled, query.isError, query.dataUpdatedAt, resumedAt, now);
  const connectionsCurrent = mapReadIsCurrent(enabled, connections.isError, connections.dataUpdatedAt, resumedAt, now);
  return { ...query, data: current ? query.data : undefined, clock: now, enabled,
    acceptedCandidateIds: connectionsCurrent ? currentMapPeerIds(connections.data, now) : [],
    connectionsError: enabled && connections.isError,
    isFetching: query.isFetching || connections.isFetching,
    refetch: () => { void query.refetch(); void connections.refetch(); },
  };
}
