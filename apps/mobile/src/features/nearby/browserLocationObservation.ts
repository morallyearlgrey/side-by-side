import type { PresencePoint } from './presenceLocation.types';

const APPLE_REFERENCE_EPOCH_MS = Date.UTC(2001, 0, 1);

/** Correct the observed Safari timestamp signature without making old fixes fresh. */
export function browserLocationObservation<T extends PresencePoint>(point: T): T {
  const appleWebKit = typeof navigator !== 'undefined' && navigator.vendor === 'Apple Computer, Inc.'
    && /AppleWebKit\//.test(navigator.userAgent)
    && !/(?:Chrome|Chromium|CriOS|Edg|OPR|FxiOS)\//.test(navigator.userAgent);
  const timestamp = point.timestamp + APPLE_REFERENCE_EPOCH_MS;
  const age = Date.now() - timestamp;
  if (appleWebKit && point.timestamp > 0 && point.timestamp < APPLE_REFERENCE_EPOCH_MS
    && age >= -5_000 && age <= 60_000) {
    // Browser position properties can be non-enumerable host properties.
    return { ...point, coords: point.coords, timestamp };
  }
  return point;
}
