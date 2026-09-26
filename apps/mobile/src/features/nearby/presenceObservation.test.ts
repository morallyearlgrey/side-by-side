import { describe, expect, it } from 'vitest';
import { validatePresenceObservation } from './presenceObservation';

const now = Date.UTC(2026, 8, 26, 10, 30);
const point = { timestamp: now, coords: { latitude: 0, longitude: 0, accuracy: 20 } };

describe('presence observation validation', () => {
  it.each([0, 30_000, 60_000, -5_000])('accepts a recent fix without changing the observation timestamp (age=%s)', age => {
    const observed = { ...point, timestamp: now - age };
    expect(() => validatePresenceObservation(observed, now)).not.toThrow();
    expect(observed.timestamp).toBe(now - age);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid timestamp %s', timestamp => {
    expect(() => validatePresenceObservation({ ...point, timestamp }, now)).toThrow(/invalid location time/);
  });

  it('explains how old a cached fix is', () => {
    expect(() => validatePresenceObservation({ ...point, timestamp: now - 360_000 }, now)).toThrow(/6 minutes ago/);
  });

  it('distinguishes a future observation from a stale one', () => {
    expect(() => validatePresenceObservation({ ...point, timestamp: now + 6_000 }, now)).toThrow(/6 seconds ahead/);
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1, 251])('rejects invalid or insufficient accuracy %s', accuracy => {
    expect(() => validatePresenceObservation({ ...point, coords: { ...point.coords, accuracy } }, now)).toThrow(/not precise enough/);
  });
});
