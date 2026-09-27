import { api } from '@/lib/api';
import type { ConnectionsPage } from '@/lib/types';
import { connectionPagePath } from '../connect/connectionQuery';
import { isMutuallyAccepted } from '../connect/connectionVisibility';

export type AcceptedMapPeer = { candidateId: string; expiresAt: string };

export async function loadAcceptedMapPeers(userId: string, signal?: AbortSignal): Promise<AcceptedMapPeer[]> {
  const peers = new Map<string, AcceptedMapPeer>();
  let page = 1;
  // Matches is paginated. Stopping at its first page silently drops connections.
  while (true) {
    const result = await api<ConnectionsPage>(connectionPagePath('', 'all', page),
      { signal, expectedUserId: userId, timeoutMs: 12_000 });
    for (const item of result.items) {
      if ((item.requester_id === userId || item.recipient_id === userId)
        && item.candidate_id !== userId && isMutuallyAccepted(item)
        && Date.parse(item.expires_at) > Date.now()) {
        const previous = peers.get(item.candidate_id);
        if (!previous || Date.parse(previous.expiresAt) < Date.parse(item.expires_at)) {
          peers.set(item.candidate_id, { candidateId: item.candidate_id, expiresAt: item.expires_at });
        }
      }
    }
    // The server can clamp the page if a connection is removed during this read.
    if (result.page !== page || page >= result.pages) break;
    page += 1;
  }
  return [...peers.values()];
}

export function currentMapPeerIds(peers: AcceptedMapPeer[] | undefined, now: number) {
  return peers?.filter(peer => Date.parse(peer.expiresAt) > now).map(peer => peer.candidateId) ?? [];
}

export function mapReadIsCurrent(enabled: boolean, isError: boolean, updatedAt: number, resumedAt: number, now: number) {
  return enabled && !isError && updatedAt >= resumedAt && updatedAt <= now && now - updatedAt < 20_000;
}
