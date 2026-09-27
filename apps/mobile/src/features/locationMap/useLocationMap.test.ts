import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocationMap } from './useLocationMap';

const mocks = vi.hoisted(() => ({
  now: Date.UTC(2026, 8, 27, 12), active: true, stateIndex: 0,
  mapQuery: { data: { status: 'ready' }, dataUpdatedAt: Date.UTC(2026, 8, 27, 12), isError: false, refetch: vi.fn() },
  peersQuery: { data: [{ candidateId: 'peer', expiresAt: new Date(Date.UTC(2026, 8, 27, 13)).toISOString() }],
    dataUpdatedAt: Date.UTC(2026, 8, 27, 12), isError: false, refetch: vi.fn() },
  query: vi.fn(), api: vi.fn(), load: vi.fn(),
}));
vi.mock('react', () => ({ useCallback: (value: unknown) => value, useEffect: vi.fn(),
  useState: () => [mocks.stateIndex++ === 0 ? mocks.active : mocks.now, vi.fn()],
}));
vi.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: { queryKey: string[] }) => {
  mocks.query(options);
  return options.queryKey[0] === 'connections' ? mocks.peersQuery : mocks.mapQuery;
} }));
vi.mock('@/lib/api', () => ({ api: mocks.api }));
vi.mock('./acceptedConnections', async () => ({
  ...await vi.importActual<typeof import('./acceptedConnections')>('./acceptedConnections'),
  loadAcceptedMapPeers: mocks.load,
}));
beforeEach(() => {
  vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(mocks.now);
  mocks.active = true; mocks.stateIndex = 0;
  mocks.mapQuery.isError = mocks.peersQuery.isError = false;
  mocks.mapQuery.dataUpdatedAt = mocks.peersQuery.dataUpdatedAt = mocks.now;
});
describe('location map authorization reads', () => {
  it('includes fresh accepted peers and refreshes both sources manually', async () => {
    const result = useLocationMap('viewer', true, false);
    expect(result.acceptedCandidateIds).toEqual(['peer']);
    const options = mocks.query.mock.calls[1][0];
    expect(options.queryKey).toEqual(['connections', 'location-map', 'viewer']);
    const signal = new AbortController().signal;
    await options.queryFn({ signal });
    expect(mocks.load).toHaveBeenCalledWith('viewer', signal);
    result.refetch();
    expect(mocks.mapQuery.refetch).toHaveBeenCalledOnce();
    expect(mocks.peersQuery.refetch).toHaveBeenCalledOnce();
  });
  it('hides accepted peers after a failed recheck', () => {
    mocks.peersQuery.isError = true;
    expect(useLocationMap('viewer', true, false).acceptedCandidateIds).toEqual([]);
  });
  it('hides cached data from before focus, resume or discovery re-enable', () => {
    mocks.mapQuery.dataUpdatedAt = mocks.peersQuery.dataUpdatedAt = mocks.now - 1;
    const result = useLocationMap('viewer', true, false);
    expect(result.data).toBeUndefined();
    expect(result.acceptedCandidateIds).toEqual([]);
  });
  it.each([false, true])('hides both reads when discovery is off or the screen is inactive (%s)', inactive => {
    mocks.active = !inactive;
    const result = useLocationMap('viewer', inactive, false);
    expect(result.data).toBeUndefined();
    expect(result.acceptedCandidateIds).toEqual([]);
    expect(mocks.query.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
  });
});
