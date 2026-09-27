import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiscoveryLocationMap from './DiscoveryLocationMap';
import type { LocationMapState } from './types';

const mocks = vi.hoisted(() => ({ hook: vi.fn() }));
vi.mock('./useLocationMap', () => ({ useLocationMap: mocks.hook }));
vi.mock('./GoogleLocationMap', () => ({ default: 'GoogleLocationMap' }));
vi.mock('react-native', () => ({ Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value } }));
vi.mock('@/components/ui', () => ({ Body: 'Body', Button: 'Button', Card: 'Card', Notice: 'Notice' }));
vi.mock('@/lib/api', () => ({ errorMessage: String }));
vi.mock('@/lib/theme', () => ({ colors: {} }));
const now = Date.UTC(2026, 8, 27, 12);
const area = { latitude: 33.7755, longitude: -84.3975, uncertainty_m: 300,
  observed_at: new Date(now - 1_000).toISOString(), expires_at: new Date(now + 60_000).toISOString() };
const state: LocationMapState = { status: 'ready', me: area, valid_until: area.expires_at,
  refresh_after_seconds: 15, items: ['pending', 'accepted', 'unrelated'].map(user_id => ({
    user_id, display_name: user_id, source: 'location', area,
    observed_at: area.observed_at, expires_at: area.expires_at, proximity: null,
  })) };
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function plot(props = {}) {
  const tree = DiscoveryLocationMap({ userId: 'viewer', locationEnabled: true, bluetoothEnabled: false,
    allowedCandidateIds: ['pending'], ...props });
  const map = elements(tree).find(item => item.type === 'GoogleLocationMap');
  return (map?.props.areas as { id: string }[] | undefined)?.map(item => item.id) ?? [];
}
beforeEach(() => {
  mocks.hook.mockReset().mockReturnValue({ data: state, clock: now, acceptedCandidateIds: ['accepted'] });
});
describe('Connect map keeps accepted peers without reviving old locations', () => {
  it('plots invitations and current accepted connections, but not unrelated discoveries', () => {
    expect(plot()).toEqual(['me', 'pending', 'accepted']);
  });
  it('keeps the peer after their pending invitation disappears on acceptance', () => {
    expect(plot({ allowedCandidateIds: [] })).toEqual(['me', 'accepted']);
  });
  it('does not plot accepted people absent from the fresh location response', () => {
    mocks.hook.mockReturnValue({ data: { ...state, items: [] }, clock: now, acceptedCandidateIds: ['accepted'] });
    expect(plot()).toEqual(['me']);
  });
  it('hides revoked or stale accepted connections as soon as their authorized list clears', () => {
    mocks.hook.mockReturnValue({ data: state, clock: now, acceptedCandidateIds: [] });
    expect(plot()).toEqual(['me', 'pending']);
  });
  it('never restores an expired location just because the connection still exists', () => {
    mocks.hook.mockReturnValue({ data: state, clock: now + 60_000, acceptedCandidateIds: ['accepted'] });
    expect(plot()).toEqual([]);
  });
  it('never plots while sharing is disabled', () => {
    expect(plot({ sharingAllowed: false })).toEqual([]);
    expect(mocks.hook).toHaveBeenLastCalledWith('viewer', false, false);
  });
});
