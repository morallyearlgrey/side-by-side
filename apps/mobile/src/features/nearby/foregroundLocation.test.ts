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
  it('requests a fresh precise fix even when the Permissions API is unavailable', async () => {
    const current = point();
    const getCurrentPosition = vi.fn((success: (value: typeof current) => void) => success(current));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    await expect(getFreshLocation(true)).resolves.toEqual(current);
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true, maximumAge: 0, timeout: 25_000,
    });
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('explains why an HTTP LAN preview cannot request location', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    await expect(getFreshLocation(true)).rejects.toThrow('HTTPS or localhost');
  });

  it('preserves useful guidance for a browser permission-denied object', async () => {
    vi.stubGlobal('navigator', { geolocation: {
      getCurrentPosition: (_success: unknown, reject: (value: unknown) => void) => reject({ code: 1, message: 'User denied Geolocation' }),
    } });
    try { await getFreshLocation(true); throw new Error('expected rejection'); }
    catch (error) { expect(locationError(error)).toContain('Allow location for this site'); }
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
      enableHighAccuracy: true, maximumAge: 0, timeout: 25_000,
    });
    expect(onLocation).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    subscription.remove();
    expect(clearWatch).toHaveBeenCalledWith(7);
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
