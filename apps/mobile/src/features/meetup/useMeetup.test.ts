import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMeetup } from './useMeetup';

const mocks = vi.hoisted(() => ({
  api: vi.fn(), position: vi.fn(), permission: vi.fn(), remove: vi.fn(),
  focus: null as null | (() => () => void),
  onAppState: null as null | ((value: string) => void),
  app: { currentState: 'active' },
  response: { status: 'sharing', sharing: true, peer_sharing: true, share_id: 'existing-lease' },
}));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }),
  useCallback: (callback: unknown) => callback,
}));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return mocks.app.currentState; },
  addEventListener: (_name: string, callback: (value: string) => void) => {
    mocks.onAppState = callback;
    return { remove: mocks.remove };
  },
} }));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => () => void) => { mocks.focus = callback; } }));
vi.mock('expo-location', () => ({ getForegroundPermissionsAsync: mocks.permission }));
vi.mock('@/lib/api', () => ({ api: mocks.api, errorMessage: String }));
vi.mock('@/features/nearby/presenceLocation', () => ({ getPresencePosition: mocks.position }));
vi.mock('@/features/nearby/presenceObservation', () => ({ validatePresenceObservation: vi.fn() }));

let cleanup: (() => void) | undefined;
const point = () => ({ coords: { latitude: 1, longitude: 2, accuracy: 10 }, timestamp: Date.now() });
const updates = () => mocks.api.mock.calls.filter(([, options]) => options.method === 'PATCH');

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); vi.clearAllMocks();
  mocks.app.currentState = 'active';
  mocks.response = { status: 'sharing', sharing: true, peer_sharing: true, share_id: 'existing-lease' };
  mocks.api.mockImplementation(async () => mocks.response);
  mocks.position.mockImplementation(async () => point());
  mocks.permission.mockResolvedValue({ granted: true });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); });

function MeetupHarness() {
  const result = useMeetup('pair-request', 'owner');
  cleanup = mocks.focus!();
  return result;
}

describe('live meetup updates', () => {
  it('refreshes the existing location lease every five seconds without granting new consent', async () => {
    MeetupHarness();
    await vi.advanceTimersByTimeAsync(0);
    expect(updates()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(updates()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates()).toHaveLength(2);
    expect(updates()[1]).toEqual(['/v1/connections/pair-request/location', {
      method: 'PATCH', expectedUserId: 'owner', timeoutMs: 12_000,
      body: { latitude: 1, longitude: 2, accuracy_m: 10,
        observed_at: new Date(Date.now()).toISOString(), share_id: 'existing-lease' },
    }]);
    expect(mocks.api.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
  });

  it('never samples or publishes coordinates without an active share', async () => {
    mocks.response.sharing = false;
    MeetupHarness(); await vi.advanceTimersByTimeAsync(15000);
    expect(mocks.position).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it('does not publish after OS location permission is revoked', async () => {
    mocks.permission.mockResolvedValue({ granted: false });
    MeetupHarness(); await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.position).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it('pauses updates in the background and stops timers when the view closes', async () => {
    MeetupHarness(); await vi.advanceTimersByTimeAsync(0);
    mocks.app.currentState = 'background'; mocks.onAppState!('background');
    await vi.advanceTimersByTimeAsync(15000);
    expect(updates()).toHaveLength(1);
    cleanup!(); cleanup = undefined;
    mocks.app.currentState = 'active';
    await vi.advanceTimersByTimeAsync(15000);
    expect(updates()).toHaveLength(1);
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('does not overlap slow GPS requests or publish a fix after leaving the view', async () => {
    let finish!: (value: ReturnType<typeof point>) => void;
    mocks.position.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    MeetupHarness(); await vi.advanceTimersByTimeAsync(15000);
    expect(mocks.position).toHaveBeenCalledOnce();
    cleanup!(); cleanup = undefined;
    finish(point()); await vi.advanceTimersByTimeAsync(0);
    expect(updates()).toHaveLength(0);
  });
});
