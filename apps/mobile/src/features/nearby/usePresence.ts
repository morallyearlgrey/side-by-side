import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { LocationObject, LocationSubscription } from 'expo-location';
import { api } from '@/lib/api';
import { useMe } from '@/features/profile/useMe';
import { useQueryClient } from '@tanstack/react-query';
import { getFreshLocation, locationError, validateLocation, watchForegroundLocation } from './foregroundLocation';

function isForeground() { return AppState.currentState !== 'background' && AppState.currentState !== 'inactive'; }

export function usePresence() {
  const me = useMe(); const client = useQueryClient();
  const userId = me.data?.profile.user_id;
  const enabled = !!me.data?.profile.discoverable;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'locating' | 'saving'>('idle');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const activeUser = useRef(userId); activeUser.current = userId;
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled, userId]);
  const publishing = useRef<Promise<void> | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);
  const lastObservation = useRef(0);
  const mounted = useRef(true);
  const operationGeneration = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const isCurrent = useCallback((generation: number) => mounted.current && activeUser.current === userId
    && operationGeneration.current === generation && isForeground(), [userId]);

  const publish = useCallback(async (point: LocationObject, generation = operationGeneration.current) => {
    if (!userId || !isCurrent(generation) || !enabledRef.current) return;
    validateLocation(point);
    // A watch callback and the heartbeat can arrive together. Serialize writes so
    // an older observation cannot overwrite a newer one or surface false errors.
    while (publishing.current) await publishing.current.catch(() => {});
    if (!isCurrent(generation) || !enabledRef.current || point.timestamp <= lastObservation.current) return;
    const controller = new AbortController();
    requests.current.add(controller);
    const request = (async () => {
      await api('/v1/presence', {
        method: 'PUT', expectedUserId: userId, signal: controller.signal, timeoutMs: 10_000,
        body: { latitude: point.coords.latitude, longitude: point.coords.longitude, accuracy_m: point.coords.accuracy, observed_at: new Date(point.timestamp).toISOString() },
      });
      if (!isCurrent(generation) || !enabledRef.current) return;
      lastObservation.current = point.timestamp;
      setLastUpdated(new Date()); setError('');
      // Location can move into a new two-mile circle; don't wait for the poll.
      void client.invalidateQueries({ queryKey: ['nearby', userId] }).catch(() => {});
    })();
    publishing.current = request;
    try { await request; } finally {
      requests.current.delete(controller);
      if (publishing.current === request) publishing.current = null;
    }
  }, [userId, client, isCurrent]);

  const refresh = useCallback(async () => {
    if (!enabledRef.current || !userId || !isForeground()) return;
    if (refreshing.current) return refreshing.current;
    const generation = operationGeneration.current;
    const request = (async () => {
      setStage('locating');
      try {
        const point = await getFreshLocation(false);
        if (!isCurrent(generation)) return;
        setStage('saving');
        await publish(point, generation);
      } catch (error) { if (isCurrent(generation) && enabledRef.current) setError(locationError(error)); }
      finally { if (mounted.current && activeUser.current === userId) setStage('idle'); }
    })();
    refreshing.current = request;
    try { await request; } finally { if (refreshing.current === request) refreshing.current = null; }
  }, [publish, userId, isCurrent]);

  const enable = useCallback(async () => {
    if (!userId || busy) return;
    const generation = operationGeneration.current;
    setBusy(true); setStage('locating'); setError('');
    try {
      const point = await getFreshLocation(true);
      if (!isCurrent(generation)) return;
      setStage('saving');
      if (!enabledRef.current) {
        await api('/v1/settings', { method: 'PATCH', expectedUserId: userId, timeoutMs: 10_000, body: { discoverable: true } });
        if (!isCurrent(generation)) return;
        enabledRef.current = true;
      }
      await publish(point, generation);
    } catch (error) { if (isCurrent(generation)) setError(locationError(error)); }
    finally {
      if (mounted.current && activeUser.current === userId) {
        setBusy(false); setStage('idle');
        // Refresh even if publishing failed after the opt-in was saved. The
        // screen must offer Retry instead of displaying a false success state.
        void client.invalidateQueries({ queryKey: ['me', userId] }).catch(() => {});
      }
    }
  }, [publish, client, userId, busy, isCurrent]);

  const disable = useCallback(async () => {
    if (!userId || busy) return;
    setBusy(true); setError('');
    enabledRef.current = false;
    operationGeneration.current += 1;
    for (const request of requests.current) request.abort();
    try {
      await api('/v1/settings', { method: 'PATCH', expectedUserId: userId, timeoutMs: 10_000, body: { discoverable: false } });
      if (!mounted.current || activeUser.current !== userId) return;
      setLastUpdated(null);
      void client.invalidateQueries({ queryKey: ['me', userId] }).catch(() => {});
      client.removeQueries({ queryKey: ['nearby', userId] });
    } catch (error) { if (mounted.current && activeUser.current === userId) { enabledRef.current = enabled; setError(locationError(error)); } }
    finally { if (mounted.current && activeUser.current === userId) setBusy(false); }
  }, [client, userId, busy, enabled]);

  useEffect(() => {
    mounted.current = true;
    operationGeneration.current += 1;
    lastObservation.current = 0; setLastUpdated(null); setError(''); setBusy(false); setStage('idle');
    const currentRequests = requests.current;
    const invalidate = () => {
      operationGeneration.current += 1;
      for (const request of currentRequests) request.abort();
    };
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') invalidate();
    });
    return () => { mounted.current = false; invalidate(); subscription.remove(); };
  }, [userId]);

  useEffect(() => {
    if (!enabled) {
      operationGeneration.current += 1;
      for (const request of requests.current) request.abort();
      setLastUpdated(null);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false; let generation = 0;
    let watch: LocationSubscription | undefined;
    const stopWatch = () => { generation += 1; watch?.remove(); watch = undefined; };
    const begin = async () => {
      stopWatch();
      if (!isForeground() || cancelled) return;
      const currentGeneration = generation;
      await refresh();
      if (cancelled || currentGeneration !== generation || !enabledRef.current) return;
      try {
        const subscription = await watchForegroundLocation(
          point => {
            if (!cancelled && currentGeneration === generation && enabledRef.current) {
              const operation = operationGeneration.current;
              void publish(point, operation).catch(error => {
                if (!cancelled && currentGeneration === generation && enabledRef.current && isCurrent(operation)) setError(locationError(error));
              });
            }
          },
          error => { if (!cancelled && currentGeneration === generation && enabledRef.current) setError(locationError(error)); },
        );
        if (cancelled || currentGeneration !== generation) subscription.remove(); else watch = subscription;
      } catch (error) { if (!cancelled && currentGeneration === generation) setError(locationError(error)); }
    };
    void begin();
    const interval = setInterval(() => { void refresh(); }, 60_000);
    const sub = AppState.addEventListener('change', value => { if (value === 'active') void begin(); else stopWatch(); });
    return () => { cancelled = true; stopWatch(); clearInterval(interval); sub.remove(); };
  }, [enabled, userId, refresh, publish, isCurrent]);

  return { enabled, error, busy, stage, lastUpdated, enable, disable, refresh };
}
