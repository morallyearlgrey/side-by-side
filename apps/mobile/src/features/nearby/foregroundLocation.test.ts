import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFreshLocation, locationError, validateLocation, watchForegroundLocation } from './foregroundLocation';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'web' },
  appState: { currentState: 'active', addEventListener: vi.fn() },
  getForegroundPermissionsAsync: vi.fn(), requestForegroundPermissionsAsync: vi.fn(),
  hasServicesEnabledAsync: vi.fn(), getCurrentPositionAsync: vi.fn(), watchPositionAsync: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: mocks.platform, AppState: mocks.appState }));
vi.mock('expo-location', () => ({ ...mocks, Accuracy: { High: 4 } }));

const point = (accuracy = 20, timestamp = Date.now()) => ({
  coords: { latitude: 28.6, longitude: -81.2, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform.OS = 'web';
  mocks.appState.currentState = 'active';
  vi.stubGlobal('window', { isSecureContext: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('browser location', () => {
  const safari = {
    vendor: 'Apple Computer, Inc.',
    userAgent: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15',
  };
  const appleEpoch = Date.UTC(2001, 0, 1);

  it('publishes a fresh Safari Apple-epoch fix with its actual acquisition time', async () => {
    const acquiredAt = Date.now() - 2_000;
    const raw = Object.create({ coords: point().coords, timestamp: acquiredAt - appleEpoch });
    vi.stubGlobal('navigator', { ...safari, geolocation: {
      getCurrentPosition: (success: (value: typeof raw) => void) => success(raw),
    } });
    await expect(getFreshLocation(true)).resolves.toEqual({ coords: raw.coords, timestamp: acquiredAt });
    expect(raw.timestamp).toBe(acquiredAt - appleEpoch);
  });

  it('normalizes Safari watch fixes before validating freshness', async () => {
    const onLocation = vi.fn(); const onError = vi.fn();
    const acquiredAt = Date.now() - 3_000;
    vi.stubGlobal('navigator', { ...safari, geolocation: {
      watchPosition: (success: (value: ReturnType<typeof point>) => void) => {
        success(point(20, acquiredAt - appleEpoch)); return 7;
      }, clearWatch: vi.fn(),
    } });
    const watch = await watchForegroundLocation(onLocation, onError);
    expect(onLocation).toHaveBeenCalledWith(point(20, acquiredAt));
    expect(onError).not.toHaveBeenCalled();
    watch.remove();
  });

  it.each([61_000, -6_000])('keeps rejecting stale or future Safari fixes (age %s)', async age => {
    vi.stubGlobal('navigator', { ...safari, geolocation: {
      getCurrentPosition: (success: (value: ReturnType<typeof point>) => void) => success(point(20, Date.now() - appleEpoch - age)),
    } });
    await expect(getFreshLocation(true)).rejects.toThrow('old location');
  });

  it('accepts an accurate network fix even when the Permissions API is unavailable', async () => {
    const current = point();
    const getCurrentPosition = vi.fn((success: (value: typeof current) => void) => success(current));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    await expect(getFreshLocation(true)).resolves.toEqual(current);
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: false, maximumAge: 10_000, timeout: 8_000,
    });
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('retries an imprecise network estimate with a precise fix', async () => {
    const current = point();
    const getCurrentPosition = vi.fn((success: (value: typeof current) => void) => success(current));
    getCurrentPosition.mockImplementationOnce(success => success(point(900)));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    await expect(getFreshLocation(true)).resolves.toEqual(current);
    expect(getCurrentPosition).toHaveBeenNthCalledWith(2, expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true, maximumAge: 10_000, timeout: 17_000,
    });
  });

  it('does not accept either estimate when both are too imprecise', async () => {
    vi.stubGlobal('navigator', { geolocation: {
      getCurrentPosition: (success: (value: ReturnType<typeof point>) => void) => success(point(900)),
    } });
    await expect(getFreshLocation(true)).rejects.toThrow('more precise');
  });

  it('starts a precise retry when the network provider stalls and ignores its late callback', async () => {
    vi.useFakeTimers();
    let late!: (value: ReturnType<typeof point>) => void;
    const current = point();
    const getCurrentPosition = vi.fn((success: (value: typeof current) => void) => success(current));
    getCurrentPosition.mockImplementationOnce(success => { late = success; });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const request = getFreshLocation(true);
    await vi.advanceTimersByTimeAsync(8_000);
    late(point(900));
    await expect(request).resolves.toEqual(current);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('explains why an HTTP LAN preview cannot request location', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    await expect(getFreshLocation(true)).rejects.toThrow('HTTPS or localhost');
  });

  it('preserves useful guidance for a browser permission-denied object', async () => {
    const getCurrentPosition = vi.fn((_success: unknown, reject: (value: unknown) => void) => reject({ code: 1, message: 'User denied Geolocation' }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    try { await getFreshLocation(true); throw new Error('expected rejection'); }
    catch (error) { expect(locationError(error)).toContain('Allow location for this site'); }
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it('times out when the browser never delivers a fix', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn() } });
    const request = getFreshLocation(true);
    const assertion = expect(request).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(25_000);
    await assertion;
    expect(locationError({ code: 3 })).toContain('allow Codex or your browser');
  });

  it('uses accurate fresh watch fixes and removes the browser watch on cleanup', async () => {
    const onLocation = vi.fn(); const onError = vi.fn(); const clearWatch = vi.fn();
    const watchPosition = vi.fn((success: (value: ReturnType<typeof point>) => void) => {
      success(point(900)); success(point()); return 7;
    });
    vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } });
    const subscription = await watchForegroundLocation(onLocation, onError);
    expect(watchPosition).toHaveBeenCalledWith(expect.any(Function), onError, {
      enableHighAccuracy: true, maximumAge: 10_000, timeout: 25_000,
    });
    expect(onLocation).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    subscription.remove();
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it('uses network positioning for a Mac watch while retaining accuracy validation', async () => {
    const onLocation = vi.fn(); const onError = vi.fn();
    const watchPosition = vi.fn((success: (value: ReturnType<typeof point>) => void) => {
      success(point(900)); success(point()); return 7;
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', geolocation: { watchPosition } });
    await watchForegroundLocation(onLocation, onError);
    expect(watchPosition).toHaveBeenCalledWith(expect.any(Function), onError, {
      enableHighAccuracy: false, maximumAge: 10_000, timeout: 25_000,
    });
    expect(onLocation).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('native location', () => {
  beforeEach(() => {
    mocks.platform.OS = 'ios';
    mocks.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    mocks.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    mocks.hasServicesEnabledAsync.mockResolvedValue(true);
    mocks.getCurrentPositionAsync.mockResolvedValue(point());
  });
  it('checks system services and requests high accuracy after explicit opt-in', async () => {
    await getFreshLocation(true);
    expect(mocks.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.hasServicesEnabledAsync).toHaveBeenCalledOnce();
    expect(mocks.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 4 });
  });
  it('bounds a native permission provider that never settles', async () => {
    vi.useFakeTimers();
    mocks.requestForegroundPermissionsAsync.mockReturnValue(new Promise(() => {}));
    const request = getFreshLocation(true);
    const assertion = expect(request).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(25_000);
    await assertion;
    expect(mocks.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
  it('does not repeatedly prompt permission during the heartbeat', async () => {
    await getFreshLocation(false);
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
  it('waits for iOS to become active after allowing its permission dialog', async () => {
    mocks.appState.currentState = 'inactive';
    let stateChanged!: (state: string) => void;
    const remove = vi.fn();
    mocks.appState.addEventListener.mockImplementation((_event, callback) => {
      stateChanged = callback; return { remove };
    });
    const request = getFreshLocation(true);
    await Promise.resolve();
    expect(mocks.getCurrentPositionAsync).not.toHaveBeenCalled();
    mocks.appState.currentState = 'active'; stateChanged('active');
    await expect(request).resolves.toMatchObject({ coords: { accuracy: 20 } });
    expect(remove).toHaveBeenCalledOnce();
  });
  it('does not acquire a position if the app backgrounds during the permission dialog', async () => {
    mocks.appState.currentState = 'inactive';
    let stateChanged!: (state: string) => void;
    const remove = vi.fn();
    mocks.appState.addEventListener.mockImplementation((_event, callback) => {
      stateChanged = callback; return { remove };
    });
    const request = getFreshLocation(true);
    await Promise.resolve();
    mocks.appState.currentState = 'background'; stateChanged('background');
    await expect(request).rejects.toThrow('Return to the app');
    expect(mocks.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });
  it('cleans up a permission-dialog wait that never resumes', async () => {
    vi.useFakeTimers(); mocks.appState.currentState = 'inactive';
    const remove = vi.fn();
    mocks.appState.addEventListener.mockReturnValue({ remove });
    const request = getFreshLocation(true);
    const assertion = expect(request).rejects.toThrow('Return to the app');
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(remove).toHaveBeenCalledOnce();
    expect(mocks.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
  it('explains disabled system services before attempting a location fix', async () => {
    mocks.hasServicesEnabledAsync.mockResolvedValue(false);
    await expect(getFreshLocation(true)).rejects.toThrow('Location Services are off');
    expect(mocks.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
  it('offers Settings when iOS will no longer show a permission prompt', async () => {
    mocks.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    await expect(getFreshLocation(true)).rejects.toThrow('Open Settings');
    expect(mocks.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});

it('rejects old cached coordinates before enabling discovery or writing presence', () => {
  expect(() => validateLocation(point(20, Date.now() - 61_000))).toThrow('old location');
});
it('does not treat an approximate or invalid location as a two-mile presence', () => {
  expect(() => validateLocation(point(1000))).toThrow('more precise');
  expect(() => validateLocation(point(-1))).toThrow('more precise');
  expect(() => validateLocation({ ...point(), coords: { ...point().coords, latitude: NaN } })).toThrow('invalid location');
});
