import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchDescriptionResult } from '../../lib/types';
import { descriptionIdentity, matchDescriptionKey, matchDescriptionOptions, type DescriptionIdentity } from './matchDescriptionQuery';

const identity: DescriptionIdentity = { ownerId: 'owner', target: { candidate_id: 'peer', viewer_version_id: 'v1', candidate_version_id: 'p1', mode: 'nearby' }, previewKey: 'approved-previews-v1' };
const result: MatchDescriptionResult = { status: 'ready', provider: null, source: 'fallback', description: 'An idea to explore together.', conversation_starter: 'What would you enjoy doing?', basis: 'general_activity', activities: [] };
const clients: QueryClient[] = [];
const makeClient = () => { const client = new QueryClient(); clients.push(client); return client; };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { for (const client of clients.splice(0)) client.clear(); vi.useRealTimers(); });

describe('automatic match ideas', () => {
  it('shares a generation between a card and popup with bounded catalog revalidation', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const response = deferred<MatchDescriptionResult>();
    const fetch = vi.fn(() => response.promise);
    const options = matchDescriptionOptions(identity, fetch);
    expect(options.refetchInterval).toBe(60_000);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
    const card = new QueryObserver(client, options);
    const popup = new QueryObserver(client, options);
    const closeCard = card.subscribe(() => {});
    const closePopup = popup.subscribe(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    const pending = client.fetchQuery(options);
    response.resolve(result);
    await pending;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(card.getCurrentResult().data).toEqual(result);
    expect(popup.getCurrentResult().data).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
    closeCard(); closePopup();
  });

  it('cancels a departed context and never caches its late result', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const response = deferred<MatchDescriptionResult>();
    let signal: AbortSignal | undefined;
    const options = matchDescriptionOptions(identity, (_identity, requestSignal) => { signal = requestSignal; return response.promise; });
    const card = new QueryObserver(client, options);
    const popup = new QueryObserver(client, options);
    const closeCard = card.subscribe(() => {});
    const closePopup = popup.subscribe(() => {});
    closePopup();
    expect(signal?.aborted).toBe(false);
    closeCard();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    response.resolve(result);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getQueryData(matchDescriptionKey(identity))).toBeUndefined();
  });

  it('does not share sensitive wording across owners, profile versions, or accepted connections', async () => {
    const client = makeClient();
    client.setQueryData(matchDescriptionKey(identity), result);
    for (const changed of [
      { ...identity, ownerId: 'another-owner' },
      { ...identity, target: { ...identity.target, viewer_version_id: 'v2' } },
      { ...identity, target: { ...identity.target, candidate_version_id: 'p2' } },
      { ...identity, target: { ...identity.target, connection_id: 'connection' } },
      { ...identity, previewKey: 'changed-approved-previews' },
    ]) expect(client.getQueryData(matchDescriptionKey(changed))).toBeUndefined();
  });

  it('leaves generation failures available for explicit retry without an automatic loop', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const fetch = vi.fn(async () => { throw new Error('temporarily unavailable'); });
    const options = matchDescriptionOptions(identity, fetch);
    const card = new QueryObserver(client, options);
    const closeCard = card.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const popup = new QueryObserver(client, options);
    const closePopup = popup.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(popup.getCurrentResult().isError).toBe(true);
    closeCard(); closePopup();
  });

  it('retires wording when either approved preview disappears or changes', () => {
    const preview = { enabled: true, display_name: 'Person', interests: ['walking'] };
    const before = descriptionIdentity('owner', identity.target, preview, preview)!;
    expect(descriptionIdentity('owner', identity.target, { ...preview, enabled: false }, preview)).toBeNull();
    expect(descriptionIdentity('owner', identity.target, preview, null)).toBeNull();
    expect(descriptionIdentity('owner', identity.target, preview, { ...preview, enabled: false })).toBeNull();
    const changed = { ...preview, interests: ['art'] };
    for (const after of [descriptionIdentity('owner', identity.target, changed, preview)!, descriptionIdentity('owner', identity.target, preview, changed)!]) {
      expect(matchDescriptionKey(after)).not.toEqual(matchDescriptionKey(before));
    }
  });
});
