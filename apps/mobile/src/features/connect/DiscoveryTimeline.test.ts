import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiscoveryTimeline } from './DiscoveryTimeline';
import type { Discovery } from '../../lib/types';

const key = 'a'.repeat(64);
const item = (event_key = key): Discovery => ({ event_key, candidate_id: 'fictional-peer', viewer_version_id: 'v1', candidate_version_id: 'v2',
  status: 'recommend', sources: ['nearby'], preview: { display_name: 'Fictional Alex', interests: ['pottery'] }, preference: null,
  valid_until: new Date(Date.now()+20_000).toISOString() });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => vi.useRealTimers());

it('shows a banner for exactly five seconds and a tile for sixty seconds from FIRST surfacing', () => {
  const timeline = new DiscoveryTimeline(); timeline.receive([item()]);
  vi.advanceTimersByTime(4_999); expect(timeline.snapshot().banner).not.toBeNull();
  vi.advanceTimersByTime(1); expect(timeline.snapshot().banner).toBeNull();
  for (let n = 0; n < 5; n++) { vi.advanceTimersByTime(10_000); timeline.receive([item()]); }
  expect(timeline.snapshot().items).toHaveLength(1);
  vi.advanceTimersByTime(4_999); expect(timeline.snapshot().items).toHaveLength(1);
  vi.advanceTimersByTime(1); expect(timeline.receive([item()]).items).toHaveLength(0);
  expect(timeline.receive([item()]).banner).toBeNull();
});
it('deduplicates source changes, repeated polls, and BLE rotations', () => {
  const timeline = new DiscoveryTimeline(); timeline.receive([item(), { ...item(), sources: ['ble'] }]);
  vi.advanceTimersByTime(5_000);
  expect(timeline.receive([{ ...item(), sources: ['nearby', 'ble'] }]).banner).toBeNull();
  expect(timeline.snapshot().items).toHaveLength(1);
});
it('expires through background and reload, preserving tombstones only', () => {
  const timeline = new DiscoveryTimeline(); timeline.receive([item()]); const stored = timeline.serialized();
  expect(stored).not.toContain('Fictional Alex');
  timeline.hide(); vi.advanceTimersByTime(61_000);
  const restored = new DiscoveryTimeline(Date.now, JSON.parse(stored));
  expect(restored.receive([item()]).items).toHaveLength(0);
  expect(restored.receive([item('b'.repeat(64))]).banner).not.toBeNull();
});
it('drops withdrawn/expired leases and bounds its notification queue', () => {
  const timeline = new DiscoveryTimeline();
  timeline.receive(Array.from({ length: 13 }, (_, n) => item(n.toString(16).repeat(64))));
  for (let n = 0; n < 4; n++) vi.advanceTimersByTime(5_000);
  expect(timeline.snapshot()).toMatchObject({ items: [], banner: null, popup: null });
  expect(timeline.receive([]).popup).toBeNull();
});
it('does not accept a radio observation without a recommendation', () => {
  const timeline = new DiscoveryTimeline();
  expect(timeline.receive([{ ...item(), status: 'pending' } as unknown as Discovery]).items).toEqual([]);
});
