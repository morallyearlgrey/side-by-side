import type { PresencePoint, PresenceWatch } from './presenceLocation.types';
import { validatePresenceObservation } from './presenceObservation';

// Expo SDK 54's web watch cleanup calls a missing legacy EventEmitter method.
// Keep web subscriptions entirely within the browser geolocation API.
const TIMEOUT_MS = 15_000;
const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: TIMEOUT_MS };
const APPLE_REFERENCE_EPOCH_MS = Date.UTC(2001, 0, 1);

function browserPoint(point: GeolocationPosition): PresencePoint {
  const appleWebKit = navigator.vendor === 'Apple Computer, Inc.'
    && /AppleWebKit\//.test(navigator.userAgent)
    && !/(?:Chrome|Chromium|CriOS|Edg|OPR|FxiOS)\//.test(navigator.userAgent);
  const timestamp = point.timestamp + APPLE_REFERENCE_EPOCH_MS;
  const age = Date.now() - timestamp;
  // Only correct the observed Apple-reference epoch signature on Apple WebKit.
  // Preserve the acquisition time; never replace an old observation with Date.now().
  if (appleWebKit && point.timestamp > 0 && point.timestamp < APPLE_REFERENCE_EPOCH_MS
    && age >= -5_000 && age <= 60_000) {
    return { coords: point.coords, timestamp };
  }
  return point;
}

function geolocation(): Geolocation {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('Location is unavailable in this browser. Use HTTPS or localhost and enable location access.');
  }
  return navigator.geolocation;
}

function locationError(error: Pick<GeolocationPositionError, 'code'>): Error {
  if (error.code === 1) return new Error('Allow location access for this site in your browser settings, then try again.');
  if (error.code === 3) return new Error('Getting your location took too long. Check location access and try again.');
  return new Error('Your location is unavailable. Check your device location settings and try again.');
}

export function getPresencePosition(_requestPermission = false): Promise<PresencePoint> {
  return new Promise((resolve, reject) => {
    const location = geolocation();
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    // Browser timeouts may exclude time spent waiting for the permission dialog.
    const timer = setTimeout(() => fail(locationError({ code: 3 })), TIMEOUT_MS);
    try {
      location.getCurrentPosition(point => {
        if (settled) return;
        const observed = browserPoint(point);
        try { validatePresenceObservation(observed); }
        catch (error) { fail(error); return; }
        settled = true;
        clearTimeout(timer);
        resolve(observed);
      }, error => fail(locationError(error)), options);
    } catch (error) {
      fail(error);
    }
  });
}

export async function watchPresencePosition(
  onPoint: (point: PresencePoint) => void,
  onError: (error: Error) => void,
): Promise<PresenceWatch> {
  const location = geolocation();
  let removed = false;
  let lastUpdateAt = Date.now();
  const id = location.watchPosition(point => {
    // The initial fix was already published; web has no Expo timeInterval option.
    if (removed || Date.now() - lastUpdateAt < 60_000) return;
    lastUpdateAt = Date.now();
    const observed = browserPoint(point);
    try { validatePresenceObservation(observed); }
    catch (error) { onError(error instanceof Error ? error : new Error('Location is unavailable.')); return; }
    onPoint(observed);
  }, error => {
    if (!removed) onError(locationError(error));
  }, options);
  return {
    remove() {
      if (removed) return;
      removed = true;
      location.clearWatch(id);
    },
  };
}
