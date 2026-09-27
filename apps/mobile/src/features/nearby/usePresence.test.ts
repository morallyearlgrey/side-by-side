import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySettings, type Me } from '../../lib/types';
import { usePresence } from './usePresence';

const mocks = vi.hoisted(() => ({ client: null as QueryClient | null, api: vi.fn(), location: vi.fn() }));
// Keep React state unchanged to reproduce two taps before React can re-render.
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => [initial, vi.fn()], useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback, useEffect: vi.fn(),
}));
vi.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
vi.mock('@tanstack/react-query', async () => ({ ...await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query'), useQueryClient: () => mocks.client }));
vi.mock('@/features/profile/useMe', () => ({ useMe: () => ({ data: mocks.client?.getQueryData(['me', 'A']) }) }));
vi.mock('@/lib/api', () => ({ api: mocks.api }));
vi.mock('./foregroundLocation', () => ({ getFreshLocation: mocks.location, validateLocation: vi.fn(), locationError: String, watchForegroundLocation: vi.fn() }));

const me = (enabled = false): Me => ({ profile: { user_id: 'A', display_name: 'Fictional A', current_profile_version_id: 'version',
  discoverable: enabled, settings: { ...emptySettings, discoverable: enabled } }, current_version: null, preview: null,
onboarding: null, readiness: {}, matching_consent: true });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mocks.client.setQueryData(['me', 'A'], me());
  mocks.api.mockResolvedValue({});
  mocks.location.mockResolvedValue({ coords: { latitude: 1, longitude: 2, accuracy: 20 }, timestamp: Date.now() });
});
afterEach(() => mocks.client?.clear());

describe('location toggle actions', () => {
  it('serializes rapid enable taps and refreshes current discoveries after publishing', async () => {
    const invalidate = vi.spyOn(mocks.client!, 'invalidateQueries');
    const presence = usePresence();
    await Promise.all([presence.enable(), presence.enable()]);
    expect(mocks.location).toHaveBeenCalledOnce();
    expect(mocks.api.mock.calls.filter(([path]) => path === '/v1/settings')).toHaveLength(1);
    expect(mocks.api.mock.calls.filter(([path]) => path === '/v1/presence')).toHaveLength(1);
    expect(mocks.client?.getQueryData<Me>(['me', 'A'])?.profile.discoverable).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['discoveries'] }, { cancelRefetch: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['discovery-location-map', 'A'] }, { cancelRefetch: false });
  });
  it('serializes rapid off taps, confirms off immediately, and retires a discovery read', async () => {
    mocks.client!.setQueryData(['me', 'A'], me(true));
    const invalidate = vi.spyOn(mocks.client!, 'invalidateQueries');
    const cancel = vi.spyOn(mocks.client!, 'cancelQueries');
    const presence = usePresence();
    await Promise.all([presence.disable(), presence.disable()]);
    expect(mocks.api).toHaveBeenCalledOnce();
    expect(mocks.client?.getQueryData<Me>(['me', 'A'])?.profile.discoverable).toBe(false);
    expect(cancel).toHaveBeenCalledWith({ queryKey: ['discoveries'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['discoveries'] }, { cancelRefetch: false });
  });
  it('releases the action lock after a failed location lookup so Retry works', async () => {
    mocks.location.mockRejectedValueOnce(new Error('Permission denied'));
    const presence = usePresence();
    await presence.enable();
    expect(mocks.api).not.toHaveBeenCalled();
    await presence.enable();
    expect(mocks.api.mock.calls.filter(([path]) => path === '/v1/presence')).toHaveLength(1);
  });
});
