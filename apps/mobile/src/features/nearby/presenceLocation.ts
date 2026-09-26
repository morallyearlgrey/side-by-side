import * as Location from 'expo-location';
import type { PresencePoint, PresenceWatch } from './presenceLocation.types';

export async function getPresencePosition(requestPermission = false): Promise<PresencePoint> {
  const permission = await (requestPermission
    ? Location.requestForegroundPermissionsAsync()
    : Location.getForegroundPermissionsAsync());
  if (permission.status !== 'granted') {
    throw new Error('Allow location access in your phone settings to discover people nearby.');
  }
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
}

export function watchPresencePosition(
  onPoint: (point: PresencePoint) => void,
  onError: (error: Error) => void,
): Promise<PresenceWatch> {
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 60_000 },
    onPoint,
    message => onError(new Error(message)),
  );
}
