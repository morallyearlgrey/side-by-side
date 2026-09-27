import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BANNER_MS, DiscoveryTimeline, POPUP_MS } from './DiscoveryTimeline';
import type { Discovery } from '../../lib/types';

const key = 'a'.repeat(64);
const item = (event_key = key, leaseMs = 20_000): Discovery => ({ event_key, candidate_id: 'fictional-peer', viewer_version_id: 'v1', candidate_version_id: 'v2',
  status: 'recommend', sources: ['nearby'], preview: { display_name: 'Fictional Alex', interests: ['pottery'] }, preference: null,
  valid_until: new Date(Date.now() + leaseMs).toISOString() });
const renewFor = (timeline: DiscoveryTimeline, milliseconds: number) => {
  for (let elapsed = 0; elapsed < milliseconds;) {
    const step = Math.min(10_000, milliseconds - elapsed);
    vi.advanceTimersByTime(step);
    timeline.receive([item()]);
    elapsed += step;
  }
};
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => vi.useRealTimers());

it('keeps renewed cards after the automatic popup closes at ten seconds', () => {
  const timeline = new DiscoveryTimeline();
  expect(timeline.receive([item()])).toMatchObject({ banner: { event_key: key }, popup: { event_key: key } });
  vi.advanceTimersByTime(BANNER_MS - 1); expect(timeline.snapshot().banner).not.toBeNull();
  vi.advanceTimersByTime(1); expect(timeline.snapshot().banner).toBeNull();
  renewFor(timeline, POPUP_MS - BANNER_MS - 1);
  expect(timeline.snapshot().popup).not.toBeNull();
  vi.advanceTimersByTime(1);
  expect(timeline.receive([item()])).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
  renewFor(timeline, 4 * POPUP_MS);
  expect(timeline.snapshot()).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
});
it('allows an explicit reopen while fresh, with a new popup deadline that polling cannot extend', () => {
  const timeline = new DiscoveryTimeline(); timeline.receive([item()]);
  renewFor(timeline, POPUP_MS + 10_000);
  expect(timeline.snapshot().popup).toBeNull();
  expect(timeline.open(key).popup?.event_key).toBe(key);
  renewFor(timeline, POPUP_MS - 1);
  expect(timeline.snapshot().popup?.event_key).toBe(key);
  vi.advanceTimersByTime(1);
  expect(timeline.snapshot()).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
  expect(timeline.open(key).popup?.event_key).toBe(key);
});
it('deduplicates source changes, repeated polls, BLE rotations, and dismissed popups', () => {
  const timeline = new DiscoveryTimeline(); timeline.receive([item(), { ...item(), sources: ['ble'] }]);
  expect(timeline.dismissPopup().popup).toBeNull();
  expect(timeline.receive([{ ...item(), sources: ['nearby', 'ble'] }]).popup).toBeNull();
  timeline.dismissBanner();
  vi.advanceTimersByTime(BANNER_MS);
  expect(timeline.receive([item()])).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
  expect(timeline.seen.size).toBe(1);
});
it('restores fresh cards after backgrounding or reload without replaying saved notifications', () => {
  const timeline = new DiscoveryTimeline(); timeline.receive([item()]); const stored = timeline.serialized();
  expect(stored).not.toContain('Fictional Alex');
  expect(timeline.hide()).toEqual({ items: [], banner: null, popup: null });
  vi.advanceTimersByTime(POPUP_MS + 1_000);
  expect(timeline.receive([item()])).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
  const restored = new DiscoveryTimeline(Date.now, JSON.parse(stored));
  expect(restored.receive([item()])).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
  expect(restored.receive([item(), item('b'.repeat(64))]).banner?.event_key).toBe('b'.repeat(64));
});
it('removes expired leases immediately and only restores a card after a fresh server lease', () => {
  const timeline = new DiscoveryTimeline(); const original = item(); timeline.receive([original]);
  vi.advanceTimersByTime(20_000);
  expect(timeline.snapshot()).toEqual({ items: [], banner: null, popup: null });
  expect(timeline.open(key).popup).toBeNull();
  expect(timeline.receive([original]).items).toEqual([]);
  expect(timeline.receive([item()])).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
});
it('removes a withdrawn recommendation and its popup immediately, without notifying on reappearance', () => {
  const timeline = new DiscoveryTimeline(); timeline.receive([item()]);
  expect(timeline.receive([])).toEqual({ items: [], banner: null, popup: null });
  expect(timeline.open(key).popup).toBeNull();
  expect(timeline.receive([item()])).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
});
it('bounds the notification queue without dropping current server recommendations', () => {
  const timeline = new DiscoveryTimeline();
  const discoveries = Array.from({ length: 13 }, (_, n) => item(n.toString(16).repeat(64), 120_000));
  const first = timeline.receive(discoveries);
  const banners = new Set([first.banner?.event_key]);
  for (let n = 0; n < 12; n++) {
    vi.advanceTimersByTime(BANNER_MS);
    const state = timeline.snapshot();
    if (state.banner) banners.add(state.banner.event_key);
    expect(state.items).toHaveLength(13);
  }
  expect(banners.size).toBe(8);
  expect(timeline.snapshot()).toMatchObject({ banner: null, popup: null });
});
it('keeps fresh cards and manual viewing at the seen-history cap while suppressing automatic alerts', () => {
  const stored: [string, number][] = Array.from({ length: 10_000 }, (_, n) => [n.toString(16).padStart(64, '0'), Date.now() - 100_000]);
  const timeline = new DiscoveryTimeline(Date.now, stored);
  expect(timeline.receive([item()])).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
  expect(timeline.open(key).popup?.event_key).toBe(key);
  renewFor(timeline, POPUP_MS);
  expect(timeline.snapshot()).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
  expect(timeline.seen.size).toBe(10_000);
  const restored = new DiscoveryTimeline(Date.now, JSON.parse(timeline.serialized()));
  expect(restored.receive([item()])).toMatchObject({ items: [{ event_key: key }], banner: null, popup: null });
});
it('does not turn pending radio observations or malformed leases into recommendations or alert history', () => {
  const timeline = new DiscoveryTimeline();
  const bad = [{ ...item(), status: 'pending' } as unknown as Discovery, { ...item(), valid_until: 'not-a-date' }, item(key, 0), item('not-an-event-key')];
  expect(timeline.receive(bad)).toEqual({ items: [], banner: null, popup: null });
  expect(timeline.seen.size).toBe(0);
});
