import type { PresencePoint } from './presenceLocation.types';

export function validatePresenceObservation(point: PresencePoint, now = Date.now()): void {
  const age = now - point.timestamp;
  if (!Number.isFinite(age) || point.timestamp <= 0) {
    throw new Error('Your device returned an invalid location time. Check automatic date and time, then refresh location.');
  }
  if (age < -5_000) {
    throw new Error(`Your location time is ${Math.ceil(-age / 1_000)} seconds ahead of your device clock. Check automatic date and time, then refresh location.`);
  }
  if (age > 60_000) {
    throw new Error(`Your device returned a location from ${Math.ceil(age / 60_000)} minutes ago. Check Location Services, then refresh location.`);
  }
  if (point.coords.accuracy === null || !Number.isFinite(point.coords.accuracy) || point.coords.accuracy < 0 || point.coords.accuracy > 250) {
    throw new Error('Your location is not precise enough yet. Try again in a moment.');
  }
}
