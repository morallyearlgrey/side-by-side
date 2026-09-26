import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Location from 'expo-location';
import { getPresencePosition, watchPresencePosition } from './presenceLocation';

vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

describe('native presence location', () => {
  it.each([false, true])('uses Expo foreground permissions (request=%s)', async request => {
    const permission = { status: 'granted' } as Location.LocationPermissionResponse;
    vi.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(permission);
    vi.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(permission);
    await getPresencePosition(request);
    expect(request ? Location.requestForegroundPermissionsAsync : Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(request ? Location.getForegroundPermissionsAsync : Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledExactlyOnceWith({ accuracy: Location.Accuracy.Balanced });
  });

  it('does not request a position when permission is denied', async () => {
    vi.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'denied' } as Location.LocationPermissionResponse);
    await expect(getPresencePosition()).rejects.toThrow(/phone settings/);
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('keeps the native watch options and subscription, and forwards errors', async () => {
    const watch = { remove: vi.fn() };
    vi.mocked(Location.watchPositionAsync).mockResolvedValue(watch);
    const onPoint = vi.fn(); const onError = vi.fn();
    expect(await watchPresencePosition(onPoint, onError)).toBe(watch);
    expect(Location.watchPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 60_000 }, onPoint, expect.any(Function));
    vi.mocked(Location.watchPositionAsync).mock.calls[0][2]?.('Location failed');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Location failed' }));
  });
});
