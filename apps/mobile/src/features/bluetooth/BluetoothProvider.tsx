import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import * as NearbyBle from '../../../modules/nearby-ble';
import { api } from '@/lib/api';
import type { Encounter } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe } from '@/features/profile/useMe';
import { queryClient } from '@/lib/query';
import { BleSessionController } from './BleSessionController';
import { registerBleSession } from './registerBleSession';

type BleState = Awaited<ReturnType<typeof NearbyBle.getState>>;
type BluetoothContextValue = { state: BleState; busy: boolean; error: string; encounters: Encounter[]; start: () => Promise<void>; stop: () => Promise<void> };
const initial: BleState = { available: false, live: false, status: 'idle', scanning: false, advertising: false };
const Context = createContext<BluetoothContextValue>({ state: initial, busy: false, error: '', encounters: [], start: async () => {}, stop: async () => {} });

export function BluetoothProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const me = useMe();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const controllerRef = useRef<BleSessionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new BleSessionController({
      native: NearbyBle,
      create: owner => registerBleSession(queryClient, owner,
        () => api('/v1/ble/sessions', { method: 'POST', expectedUserId: owner })),
      revoke: owner => api('/v1/ble/sessions', { method: 'DELETE', expectedUserId: owner }),
      encounter: (owner, event) => api('/v1/ble/encounters', { method: 'POST', expectedUserId: owner, body: { token: event.token, rssi: event.rssi } }),
      appState: () => AppState.currentState,
      state: setState, busy: setBusy, error: setError,
      result: result => setEncounters(old => [result, ...old.filter(x => x.candidate_id !== result.candidate_id)].slice(0, 20)),
      clear: () => setEncounters([]),
      changed: () => { void queryClient.invalidateQueries({ queryKey: ['me'] }); },
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    let mounted = true;
    void NearbyBle.getState().then(next => { if (mounted) controller.handleState(next); }).catch(() => {});
    const states = NearbyBle.addStateListener(next => controller.handleState(next));
    const seen = NearbyBle.addEncounterListener(event => { void controller.handleEncounter(event); });
    const app = AppState.addEventListener('change', value => controller.handleAppState(value));
    return () => {
      mounted = false;
      states.remove(); seen.remove(); app.remove();
      void controller.stop();
    };
  }, [controller]);

  useEffect(() => { controller.setOwner(session?.user.id); }, [controller, session?.user.id]);
  useEffect(() => {
    if (!me.isFetching && me.data) {
      controller.acceptRemoteState(me.dataUpdatedAt, me.data.matching_consent, me.data.profile.bluetooth_enabled);
    }
  }, [controller, me.dataUpdatedAt, me.isFetching, me.data]);

  // Auth may render a new account before effects retire the previous session.
  const sameOwner = controller.belongsTo(session?.user.id);
  return <Context.Provider value={{ state: sameOwner ? state : initial, busy: sameOwner && busy, error: sameOwner ? error : '', encounters: sameOwner ? encounters : [], start: () => controller.start(), stop: () => controller.stop() }}>{children}</Context.Provider>;
}
export const useBluetooth = () => useContext(Context);
