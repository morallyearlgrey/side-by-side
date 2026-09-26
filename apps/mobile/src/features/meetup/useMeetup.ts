import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getForegroundPermissionsAsync } from 'expo-location';
import { api, errorMessage } from '@/lib/api';
import { getPresencePosition } from '@/features/nearby/presenceLocation';
import { validatePresenceObservation } from '@/features/nearby/presenceObservation';
import { hideMeetupPoints, type MeetupState } from './types';

export function useMeetup(requestId: string, userId: string) {
  const [state, setState] = useState<MeetupState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const epoch = useRef(0); const focused = useRef(false); const working = useRef(false);
  const lastPosition = useRef(0); const stopping = useRef(false);
  const path = `/v1/connections/${requestId}/location`;
  const request = useCallback((method = 'GET', body?: unknown) => api<MeetupState>(path, { method, body, expectedUserId: userId, timeoutMs: 12_000 }), [path, userId]);
  const current = useCallback((version: number) => epoch.current === version && focused.current && AppState.currentState === 'active', []);
  const position = useCallback(async (ask = false) => {
    const point = await getPresencePosition(ask);
    validatePresenceObservation(point);
    return { latitude: point.coords.latitude, longitude: point.coords.longitude, accuracy_m: point.coords.accuracy, observed_at: new Date(point.timestamp).toISOString() };
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    let fetching = false;
    const poll = async () => {
      if (fetching || working.current || stopping.current || !focused.current || AppState.currentState !== 'active') return;
      fetching = true;
      const version = epoch.current;
      try {
        let next = await request();
        if (!current(version)) return;
        if (next.sharing) {
          // Reading permission never opens a system prompt or renews a sharing lease.
          const permission = await getForegroundPermissionsAsync();
          if (!current(version)) return;
          if (!permission.granted) {
            setState(hideMeetupPoints(next));
            throw new Error('Location permission is not active. Stop sharing or explicitly allow location again.');
          }
        }
        if (next.sharing && next.share_id && Date.now() - lastPosition.current >= 30_000) {
          const point = await position();
          if (!current(version)) return;
          next = await request('PATCH', { ...point, share_id: next.share_id });
          if (!current(version)) return;
          lastPosition.current = Date.now();
        }
        setState(next);
        setError('');
      } catch (cause) {
        if (current(version)) { setState(hideMeetupPoints); setError(errorMessage(cause)); }
      } finally { fetching = false; }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 10_000);
    const ticker = setInterval(() => setClock(Date.now()), 1_000);
    const app = AppState.addEventListener('change', value => {
      ++epoch.current;
      setState(hideMeetupPoints);
      if (value === 'active') void poll();
    });
    return () => { focused.current = false; ++epoch.current; setState(hideMeetupPoints); clearInterval(interval); clearInterval(ticker); app.remove(); };
  }, [current, position, request]));

  const start = async () => {
    if (working.current || !focused.current || AppState.currentState !== 'active') return;
    working.current = true; stopping.current = false;
    const version = ++epoch.current;
    setBusy(true); setError('');
    try {
      const point = await position(true);
      if (!current(version)) return;
      const next = await request('POST', point);
      const permitted = await getForegroundPermissionsAsync().then(permission => permission.granted, () => false);
      if (!current(version) || !permitted) {
        // A delayed opt-in response must not leave sharing on after leaving this view.
        if (current(version)) { setState(hideMeetupPoints(next)); setError('Location permission is not active.'); }
        if (next.share_id) await request('DELETE', { share_id: next.share_id });
        return;
      }
      lastPosition.current = Date.now();
      setState(next);
    } catch (cause) { if (current(version)) setError(errorMessage(cause)); }
    finally { working.current = false; setBusy(false); }
  };

  const stop = async () => {
    if (working.current || !state?.share_id) return;
    working.current = true; stopping.current = true;
    const version = ++epoch.current;
    const shareId = state.share_id;
    setBusy(true); setError(''); setState(hideMeetupPoints);
    try {
      const next = await request('DELETE', { share_id: shareId });
      stopping.current = false;
      if (current(version)) setState(next);
    } catch (cause) {
      if (current(version)) setError(`Could not stop sharing on the server. Try Stop sharing again. ${errorMessage(cause)}`);
    } finally { working.current = false; setBusy(false); }
  };
  return { state, error, busy, clock, start, stop };
}
