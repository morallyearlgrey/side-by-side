import { describe, expect, it } from 'vitest';
import { areaBounds, estimateCaption, mapAreas, visibleEstimates, visualAreas, type LocationMapState } from './types';

const now = Date.UTC(2026, 8, 27, 2);
const area = { latitude: 33.7755, longitude: -84.3975, uncertainty_m: 300,
  observed_at: new Date(now - 1_000).toISOString(), expires_at: new Date(now + 60_000).toISOString() };
const state: LocationMapState = { status: 'ready', me: area, valid_until: area.expires_at,
  items: [{ user_id: 'peer', display_name: 'Amy', source: 'location', area,
    observed_at: area.observed_at, expires_at: area.expires_at, proximity: null }], refresh_after_seconds: 15 };

describe('privacy and freshness of discovery map estimates', () => {
  it('shows areas for both viewer and a fresh, authorized participant', () => {
    expect(mapAreas(state, now).map(item => item.id)).toEqual(['me', 'peer']);
    expect(areaBounds(area)[0].lat).toBeGreaterThan(area.latitude);
    expect(areaBounds(area)[1].lat).toBeLessThan(area.latitude);
  });
  it('clears estimates at expiry without waiting for polling', () => {
    expect(mapAreas(state, now + 60_000)).toEqual([]);
    expect(visibleEstimates(state, now + 60_000)).toEqual([]);
  });
  it('fresh observation timestamps do not rebuild the visual map or spend additional map loads', () => {
    const before = mapAreas(state, now);
    const after = before.map(item => ({ ...item, observed_at: new Date(now).toISOString(),
      expires_at: new Date(now + 120_000).toISOString() }));
    expect(visualAreas(after)).toEqual(visualAreas(before));
  });
  it.each([null, { ...state, status: 'off' as const }, { ...state, valid_until: 'bad-date' },
    { ...state, me: null }, { ...state, me: { ...area, latitude: 91 } },
    { ...state, me: { ...area, uncertainty_m: 10 } },
    { ...state, me: { ...area, observed_at: new Date(now + 6_000).toISOString() } }])(
    'never plots disabled, missing, invalid, overly precise or future coordinates', value => {
      expect(mapAreas(value, now)).toEqual([]);
    });
  it('explains that Bluetooth does not provide a peer position or bearing', () => {
    const item = { ...state.items[0], source: 'bluetooth' as const, proximity: 'nearby' as const };
    const result = mapAreas({ ...state, items: [item] }, now);
    expect(result[1].bluetooth).toBe(true);
    expect(estimateCaption(item)).toContain('direction and exact distance are unknown');
  });
  it('lists Bluetooth without inventing coordinates when the observer has no location', () => {
    const item = { ...state.items[0], source: 'bluetooth' as const, area: null };
    const radioOnly = { ...state, status: 'location_unavailable' as const, me: null, items: [item] };
    expect(visibleEstimates(radioOnly, now)).toEqual([item]);
    expect(mapAreas(radioOnly, now)).toEqual([]);
  });
});
