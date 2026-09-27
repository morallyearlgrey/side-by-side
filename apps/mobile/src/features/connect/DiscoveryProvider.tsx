import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBluetooth } from '@/features/bluetooth/BluetoothProvider';
import { usePresence } from '@/features/nearby/usePresence';
import { useMe } from '@/features/profile/useMe';
import { api, errorMessage } from '@/lib/api';
import type { Discovery } from '@/lib/types';
import { DiscoveryTimeline } from './DiscoveryTimeline';
import type { DiscoveryOutcomes } from './discoveryEmptyState';

const useDiscoveryState = () => {
  const { session } = useAuth(); const owner = session!.user.id;
  const me = useMe(); const ble = useBluetooth(); const presence = usePresence(); const client = useQueryClient();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const scope = `${owner}:${me.data?.current_version?.profile_version_id || 'unconfirmed'}`;
  const timeline = useMemo(() => new DiscoveryTimeline(Date.now, [], scope), [scope]);
  const [hydrated, setHydrated] = useState<DiscoveryTimeline | null>(null);
  const [storageError, setStorageError] = useState('');
  const [state, setState] = useState(timeline.snapshot());
  const stored = useRef('');
  const persist = useRef(Promise.resolve());
  const [resumedAt, setResumedAt] = useState(0);
  const query = useQuery({ queryKey: ['discoveries', scope, presence.enabled, ble.state.live, me.data?.profile.settings.discovery_radius_m],
    queryFn: ({ signal }) => api<{ items: Discovery[]; model?: { available?: boolean } } & Partial<DiscoveryOutcomes>>(`/v1/discoveries?location=${presence.enabled}&bluetooth=${ble.state.live}`, { signal, expectedUserId: owner }),
    enabled: active && !!me.data?.matching_consent && (presence.enabled || ble.state.live), refetchInterval: 10_000, retry: false });
  const { refetch } = query;

  useEffect(() => {
    let cancelled = false;
    setHydrated(null); stored.current = ''; setState(timeline.hide());
    void AsyncStorage.getItem(`discovery-seen:${scope}`).then(value => {
      if (cancelled) return;
      if (value) {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed) || parsed.some(x => !Array.isArray(x) || x.length !== 2 || typeof x[0] !== 'string' || typeof x[1] !== 'number')) throw new Error('Invalid history');
        const previous = new DiscoveryTimeline(Date.now, parsed as [string, number][]);
        for (const [key, time] of previous.seen) timeline.seen.set(key, time);
      }
      setStorageError(''); setHydrated(timeline);
    }).catch(() => { if (!cancelled) setStorageError('Discovery history could not be restored. Reopen the app before showing new notifications.'); });
    return () => { cancelled = true; timeline.hide(); };
  }, [scope, timeline]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', value => {
      setActive(value === 'active'); setResumedAt(Date.now()); setState(timeline.hide());
      void client.cancelQueries({ queryKey: ['discoveries'] });
      client.removeQueries({ queryKey: ['descriptions'] });
      if (value === 'active') void refetch();
    });
    return () => sub.remove();
  }, [client, timeline, refetch]);
  useEffect(() => {
    if (!active || hydrated !== timeline || !me.data?.matching_consent || query.isError || query.dataUpdatedAt < resumedAt) { setState(timeline.hide()); return; }
    const allowed = (query.data?.items || []).filter(item => item.sources.some(source => source === 'nearby' ? presence.enabled : ble.state.live));
    setState(timeline.receive(allowed));
    const serialized = timeline.serialized();
    if (serialized !== stored.current) {
      stored.current = serialized;
      persist.current = persist.current.then(() => AsyncStorage.setItem(`discovery-seen:${scope}`, serialized)).catch(() => {
        setStorageError('Discovery history could not be saved. Reopen the app before continuing.');
        setHydrated(null); setState(timeline.hide());
      });
    }
  }, [active, ble.state.live, hydrated, me.data?.matching_consent, presence.enabled, query.data, query.isError, query.dataUpdatedAt, resumedAt, scope, timeline]);
  useEffect(() => {
    if (!active || hydrated !== timeline) return;
    const timer = setInterval(() => setState(timeline.snapshot()), 250);
    return () => clearInterval(timer);
  }, [active, hydrated, timeline]);
  const visible = active && hydrated === timeline && !query.isError && !!me.data?.matching_consent && query.dataUpdatedAt >= resumedAt && Date.now() - query.dataUpdatedAt < 20_000;
  return { presence, ble, items: visible ? state.items : [], banner: visible ? state.banner : null, popup: visible ? state.popup : null,
    error: storageError || (query.error ? errorMessage(query.error) : ''), busy: query.isFetching,
    pending: query.data?.pending_count || 0, modelUnavailable: query.data?.model?.available === false,
    outcomes: visible && query.data?.candidate_count !== undefined ? {
      candidate_count: query.data.candidate_count, pending_count: query.data.pending_count ?? 0,
      insufficient_evidence_count: query.data.insufficient_evidence_count ?? 0,
      not_recommended_count: query.data.not_recommended_count ?? 0,
      unavailable_count: query.data.unavailable_count ?? 0,
    } : undefined,
    refresh: () => query.refetch(), dismissBanner: () => setState(timeline.dismissBanner()),
    dismissPopup: () => setState(timeline.dismissPopup()), open: (key: string) => setState(timeline.open(key)),
    hide: () => { setState(timeline.hide()); client.removeQueries({ queryKey: ['descriptions'] }); } };
};
const Context = createContext<ReturnType<typeof useDiscoveryState> | null>(null);
function OwnedDiscoveryProvider({ children }: PropsWithChildren) {
  const value = useDiscoveryState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function DiscoveryProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  return session ? <OwnedDiscoveryProvider key={session.user.id}>{children}</OwnedDiscoveryProvider> : <>{children}</>;
}
export const useDiscovery = () => useContext(Context);
