import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { browserLocationObservation } from './browserLocationObservation';

const LOCATION_TIMEOUT_MS = 25_000;
export const MAX_LOCATION_ACCURACY_M = 250;

export function locationError(error: unknown): string {
  if (typeof error === 'string' && error) return error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 1) return 'Location permission is blocked. Allow location for this site in your browser settings, then try again.';
  if (code === 2) return 'Your device could not find its location. Turn on Location Services and Wi-Fi, then try again.';
  if (code === 3) return Platform.OS === 'web'
    ? 'Finding your location took too long. Check your device’s Location Services. On a Mac, allow Codex or your browser in System Settings → Privacy & Security → Location Services. You can also retry in Safari or Chrome.'
    : 'Finding your location took too long. Move near a window or outdoors, then try again.';
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'We could not find your location. Check Location Services and try again.';
}

export function validateLocation(point: Location.LocationObject, now = Date.now()): void {
  if (!Number.isFinite(point.coords.latitude) || !Number.isFinite(point.coords.longitude)
    || Math.abs(point.coords.latitude) > 90 || Math.abs(point.coords.longitude) > 180) {
    throw new Error('Your device returned an invalid location. Please try again.');
  }
  if (point.coords.accuracy === null || !Number.isFinite(point.coords.accuracy)
    || point.coords.accuracy < 0 || point.coords.accuracy > MAX_LOCATION_ACCURACY_M) {
    throw new Error('Nearby needs a more precise location. Enable Precise Location for SidebySide, or move near a window and retry.');
  }
  if (!Number.isFinite(point.timestamp) || now - point.timestamp > 60_000 || point.timestamp - now > 5_000) {
    throw new Error('Your device returned an old location. Please try again for a fresh update.');
  }
}

function webGeolocation(): Geolocation {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new Error('Browser location needs HTTPS or localhost. Open the HTTPS preview, or use the iPhone app; a plain HTTP Wi-Fi address cannot request location.');
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('This browser does not provide location access. Open SidebySide in Safari or Chrome and allow location.');
  }
  return navigator.geolocation;
}

function withLocationTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(locationError({ code: 3 }))), LOCATION_TIMEOUT_MS);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// iOS can resolve its permission request before publishing the `active` event.
// Wait for that transition so a first enable is not silently dropped by the
// presence publisher's foreground guard. Never continue after backgrounding.
async function waitForPermissionDialog(): Promise<void> {
  if (AppState.currentState === 'background') throw new Error('Return to the app and retry location.');
  if (AppState.currentState !== 'inactive') return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer); subscription.remove();
      if (error) reject(error); else resolve();
    };
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') finish();
      else if (state === 'background') finish(new Error('Return to the app and retry location.'));
    });
    const timer = setTimeout(() => finish(new Error('Return to the app and retry location.')), 5_000);
    // Account for a native state change between the first read and subscription.
    if (AppState.currentState === 'active') finish();
    else if (AppState.currentState === 'background') finish(new Error('Return to the app and retry location.'));
  });
}

export function getFreshLocation(requestPermission: boolean): Promise<Location.LocationObject> {
  // Bound the whole acquisition, including a permission provider that never
  // settles, so the UI always leaves its finding-location state.
  return withLocationTimeout(acquireFreshLocation(requestPermission));
}

async function acquireFreshLocation(requestPermission: boolean): Promise<Location.LocationObject> {
  let point: Location.LocationObject;
  if (Platform.OS === 'web') {
    // Expo's web one-shot defaults maximumAge to Infinity; its permission
    // helper requires a Permissions API missing in some browsers. Geolocation
    // handles the permission prompt and supports explicit freshness/time limits.
    point = await new Promise<Location.LocationObject>((resolve, reject) => {
      webGeolocation().getCurrentPosition(value => resolve(browserLocationObservation(value)), reject, {
        enableHighAccuracy: true, maximumAge: 0, timeout: LOCATION_TIMEOUT_MS,
      });
    });
  } else {
    const permission = await (requestPermission
      ? Location.requestForegroundPermissionsAsync() : Location.getForegroundPermissionsAsync());
    if (permission.status !== 'granted') {
      throw new Error(permission.canAskAgain
        ? 'Allow location access to discover people nearby. Tap Retry location to allow it.'
        : 'Location permission is off. Open Settings and allow SidebySide to use your location while using the app.');
    }
    await waitForPermissionDialog();
    if (!await Location.hasServicesEnabledAsync()) {
      throw new Error('Location Services are off. Turn them on in your phone’s settings, then try again.');
    }
    point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  }
  validateLocation(point);
  return point;
}

export async function watchForegroundLocation(
  onLocation: (point: Location.LocationObject) => void,
  onError: (error: unknown) => void,
): Promise<Location.LocationSubscription> {
  const receive = (point: Location.LocationObject) => {
    const observed = Platform.OS === 'web' ? browserLocationObservation(point) : point;
    try { validateLocation(observed); onLocation(observed); } catch (error) { onError(error); }
  };
  if (Platform.OS === 'web') {
    const geolocation = webGeolocation();
    const watchId = geolocation.watchPosition(receive, onError, {
      enableHighAccuracy: true, maximumAge: 0, timeout: LOCATION_TIMEOUT_MS,
    });
    return { remove: () => geolocation.clearWatch(watchId) };
  }
  return Location.watchPositionAsync({
    accuracy: Location.Accuracy.High, distanceInterval: 50, timeInterval: 60_000,
  }, receive, onError);
}
