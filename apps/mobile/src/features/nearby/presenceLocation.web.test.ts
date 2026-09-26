import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPresencePosition, watchPresencePosition } from './presenceLocation.web';

const point = {
  coords: { latitude: 0, longitude: 0, accuracy: 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  timestamp: 1_000,
} as GeolocationPosition;

function setup() {
  let position!: PositionCallback;
  let failure!: PositionErrorCallback;
  let watchPoint!: PositionCallback;
  let watchError!: PositionErrorCallback;
  const geo = {
    getCurrentPosition: vi.fn((success: PositionCallback, error: PositionErrorCallback, _options: PositionOptions) => { position = success; failure = error; }),
    watchPosition: vi.fn((success: PositionCallback, error: PositionErrorCallback) => { watchPoint = success; watchError = error; return 42; }),
    clearWatch: vi.fn(),
  };
  // Safari need not implement navigator.permissions to obtain a location.
  vi.stubGlobal('navigator', { geolocation: geo });
  return { geo, position: () => position, failure: () => failure, watchPoint: () => watchPoint, watchError: () => watchError };
}

const failure = (code: number) => ({ code } as GeolocationPositionError);
const safari = {
  vendor: 'Apple Computer, Inc.',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15',
};
const unixNow = Date.UTC(2026, 8, 26, 10, 29, 28);
const appleEpoch = Date.UTC(2001, 0, 1);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('browser presence location', () => {
  it.each([false, true])('obtains a location without the Permissions API (request=%s)', async request => {
    const browser = setup();
    const result = getPresencePosition(request);
    browser.position()(point);
    expect(await result).toBe(point);
    expect(browser.geo.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([[1, /browser settings/], [2, /unavailable/], [3, /too long/]])('reports location error %s without spinning', async (code, message) => {
    const browser = setup();
    const result = getPresencePosition();
    const rejected = expect(result).rejects.toThrow(message);
    browser.failure()(failure(code));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out even if Safari never invokes either callback, and ignores a late fix', async () => {
    const browser = setup();
    const result = getPresencePosition();
    const rejected = expect(result).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    browser.position()(point);
    await expect(result).rejects.toThrow(/too long/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports unsupported geolocation without starting timers', async () => {
    vi.stubGlobal('navigator', {});
    await expect(getPresencePosition()).rejects.toThrow(/HTTPS or localhost/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up the watchdog when a browser API throws synchronously', async () => {
    const browser = setup();
    browser.geo.getCurrentPosition.mockImplementation(() => { throw new Error('Blocked'); });
    await expect(getPresencePosition()).rejects.toThrow('Blocked');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([-120_000, 120_000])('rejects a stale or future fix without rewriting its time (offset=%s)', async offset => {
    const browser = setup();
    const result = getPresencePosition();
    const rejected = expect(result).rejects.toThrow(/refresh location/);
    const invalid = { ...point, timestamp: 1_000_000 + offset } as GeolocationPosition;
    vi.setSystemTime(1_000_000);
    browser.position()(invalid);
    await rejected;
    expect(invalid.timestamp).toBe(1_000_000 + offset);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the browser watch ID exactly once and ignores callbacks after removal', async () => {
    const browser = setup();
    const onPoint = vi.fn(); const onError = vi.fn();
    const watch = await watchPresencePosition(onPoint, onError);
    watch.remove();
    watch.remove();
    expect(browser.geo.clearWatch).toHaveBeenCalledExactlyOnceWith(42);
    await vi.advanceTimersByTimeAsync(60_000);
    browser.watchPoint()(point);
    browser.watchError()(failure(1));
    expect(onPoint).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('limits watch updates to once a minute after the initial one-shot fix', async () => {
    const browser = setup();
    const onPoint = vi.fn(); const onError = vi.fn();
    await watchPresencePosition(onPoint, onError);
    browser.watchPoint()(point);
    expect(onPoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    browser.watchPoint()(point);
    browser.watchPoint()(point);
    expect(onPoint).toHaveBeenCalledExactlyOnceWith(point);
    await vi.advanceTimersByTimeAsync(60_000);
    browser.watchPoint()({ ...point, timestamp: Date.now() } as GeolocationPosition);
    expect(onPoint).toHaveBeenCalledTimes(2);
    browser.watchError()(failure(1));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/browser settings/) }));
  });

  it('reports stale watch fixes instead of publishing them', async () => {
    const browser = setup();
    const onPoint = vi.fn(); const onError = vi.fn();
    await watchPresencePosition(onPoint, onError);
    await vi.advanceTimersByTimeAsync(120_000);
    browser.watchPoint()(point);
    expect(onPoint).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/2 minutes ago/) }));
  });

  it.each([0, 12_345, 59_999])('converts Safari Apple-reference milliseconds while preserving acquisition age %s', async age => {
    const browser = setup();
    vi.stubGlobal('navigator', { ...safari, geolocation: browser.geo });
    vi.setSystemTime(unixNow);
    const raw = { ...point, timestamp: unixNow - appleEpoch - age } as GeolocationPosition;
    // Reproduce the exact apparent age in the reported screenshot.
    if (age > 0) expect(Math.ceil((unixNow - raw.timestamp) / 60_000)).toBe(16_305_121);
    const result = getPresencePosition();
    browser.position()(raw);
    const normalized = await result;
    expect(normalized.timestamp).toBe(unixNow - age);
    expect(normalized.coords).toBe(raw.coords);
    expect(raw.timestamp).toBe(unixNow - appleEpoch - age);
  });

  it('handles Safari position objects with non-enumerable host properties', async () => {
    const browser = setup();
    vi.stubGlobal('navigator', { ...safari, geolocation: browser.geo });
    vi.setSystemTime(unixNow);
    const raw = Object.create({ coords: point.coords, timestamp: unixNow - appleEpoch - 1_000 });
    const result = getPresencePosition();
    browser.position()(raw);
    expect(await result).toEqual({ coords: point.coords, timestamp: unixNow - 1_000 });
  });

  it('leaves valid Safari Unix timestamps untouched', async () => {
    const browser = setup();
    vi.stubGlobal('navigator', { ...safari, geolocation: browser.geo });
    vi.setSystemTime(unixNow);
    const raw = { ...point, timestamp: unixNow - 1_000 } as GeolocationPosition;
    const result = getPresencePosition();
    browser.position()(raw);
    expect(await result).toBe(raw);
  });

  it.each([60_001, 360_000, -5_001])('does not make a stale or future Apple-epoch observation fresh (age=%s)', async age => {
    const browser = setup();
    vi.stubGlobal('navigator', { ...safari, geolocation: browser.geo });
    vi.setSystemTime(unixNow);
    const result = getPresencePosition();
    const rejected = expect(result).rejects.toThrow(/refresh location/);
    browser.position()({ ...point, timestamp: unixNow - appleEpoch - age } as GeolocationPosition);
    await rejected;
  });

  it.each([
    { vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36' },
    { vendor: '', userAgent: 'Mozilla/5.0 Gecko/20100101 Firefox/140.0' },
    { ...safari, userAgent: 'Mozilla/5.0 AppleWebKit/605.1.15 CriOS/140.0 Mobile Safari/604.1' },
  ])('does not guess an Apple epoch for other browsers: $userAgent', async agent => {
    const browser = setup();
    vi.stubGlobal('navigator', { ...agent, geolocation: browser.geo });
    vi.setSystemTime(unixNow);
    const result = getPresencePosition();
    const rejected = expect(result).rejects.toThrow(/refresh location/);
    browser.position()({ ...point, timestamp: unixNow - appleEpoch } as GeolocationPosition);
    await rejected;
  });

  it('uses the same epoch conversion for ongoing Safari watch observations', async () => {
    const browser = setup();
    vi.stubGlobal('navigator', { ...safari, geolocation: browser.geo });
    vi.setSystemTime(unixNow);
    const onPoint = vi.fn(); const onError = vi.fn();
    const watch = await watchPresencePosition(onPoint, onError);
    await vi.advanceTimersByTimeAsync(60_000);
    browser.watchPoint()({ ...point, timestamp: Date.now() - appleEpoch - 2_000 } as GeolocationPosition);
    expect(onPoint).toHaveBeenCalledExactlyOnceWith({ coords: point.coords, timestamp: Date.now() - 2_000 });
    expect(onError).not.toHaveBeenCalled();
    watch.remove();
    expect(browser.geo.clearWatch).toHaveBeenCalledExactlyOnceWith(42);
  });
});
