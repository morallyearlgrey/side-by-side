import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ConnectionsPage } from '@/lib/types';
import { currentMapPeerIds, loadAcceptedMapPeers, mapReadIsCurrent } from './acceptedConnections';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: mocks.api }));
const now = Date.UTC(2026, 8, 27, 12);
function connection(overrides: Partial<Connection> = {}): Connection {
  return { request_id: 'request', requester_id: 'viewer', recipient_id: 'peer', candidate_id: 'peer',
    viewer_version_id: 'v1', candidate_version_id: 'v2', requester_decision: 'accepted', recipient_decision: 'accepted',
    status: 'accepted', preference: null, created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(), ...overrides };
}
function page(items: Connection[], page = 1, pages = 1): ConnectionsPage {
  return { items, page, pages, total: items.length, page_size: 6 };
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now); });

describe('accepted connections in the discovery map', () => {
  it('loads every page, binds the account and forwards cancellation', async () => {
    mocks.api.mockResolvedValueOnce(page([connection()], 1, 2))
      .mockResolvedValueOnce(page([connection({ candidate_id: 'later-peer' })], 2, 2));
    const signal = new AbortController().signal;
    const result = await loadAcceptedMapPeers('viewer', signal);
    expect(currentMapPeerIds(result, now)).toEqual(['peer', 'later-peer']);
    expect(mocks.api).toHaveBeenNthCalledWith(2, '/v1/connections/page?q=&filter=all&page=2',
      { signal, expectedUserId: 'viewer', timeoutMs: 12_000 });
    expect(Object.keys(result[0]).sort()).toEqual(['candidateId', 'expiresAt']);
  });
  it.each(['pending', 'revoked', 'declined', 'profile_changed', 'unavailable'])('excludes %s history', async status => {
    mocks.api.mockResolvedValue(page([connection({ status })]));
    expect(await loadAcceptedMapPeers('viewer')).toEqual([]);
  });
  it('requires both acceptances, viewer membership and an unexpired connection', async () => {
    mocks.api.mockResolvedValue(page([
      connection({ recipient_decision: 'pending' }), connection({ requester_id: 'outsider' }),
      connection({ candidate_id: 'viewer' }), connection({ expires_at: 'bad-date' }),
      connection({ expires_at: new Date(now).toISOString() }),
    ]));
    expect(await loadAcceptedMapPeers('viewer')).toEqual([]);
  });
  it('deduplicates peers and stops when pagination is clamped during a deletion', async () => {
    mocks.api.mockResolvedValueOnce(page([connection()], 1, 3)).mockResolvedValueOnce(page([connection()], 1, 1));
    expect(await loadAcceptedMapPeers('viewer')).toHaveLength(1);
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });
  it('fails closed rather than retaining a partial result after an account change or failed page', async () => {
    mocks.api.mockResolvedValueOnce(page([connection()], 1, 2)).mockRejectedValueOnce(new Error('account_changed'));
    await expect(loadAcceptedMapPeers('viewer')).rejects.toThrow('account_changed');
  });
  it('drops expired connections without needing another poll', () => {
    expect(currentMapPeerIds([{ candidateId: 'peer', expiresAt: new Date(now).toISOString() }], now)).toEqual([]);
  });
  it('hides reads when disabled, failed, stale or from before returning to the screen', () => {
    expect(mapReadIsCurrent(true, false, now, now, now)).toBe(true);
    expect(mapReadIsCurrent(false, false, now, now, now)).toBe(false);
    expect(mapReadIsCurrent(true, true, now, now, now)).toBe(false);
    expect(mapReadIsCurrent(true, false, now - 20_000, now - 30_000, now)).toBe(false);
    expect(mapReadIsCurrent(true, false, now - 1, now, now)).toBe(false);
  });
});
