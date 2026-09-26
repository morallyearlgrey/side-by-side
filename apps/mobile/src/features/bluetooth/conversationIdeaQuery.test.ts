import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationIdea, Encounter } from '../../lib/types';
import { conversationIdentity, conversationIdeaKey, conversationIdeaOptions, currentConversationIdea, pruneConversationIdeas } from './conversationIdeaQuery';

const encounter: Encounter = {
  candidate_id: 'candidate', status: 'recommend', score: 0.8,
  preview: { display_name: 'Alex', interests: ['gardening'] },
  conversation_context: { key: 'context-v1', reason: 'You both want to compare balcony gardening ideas.', topic: 'balcony gardening' },
};
const identity = conversationIdentity('owner', true, [encounter], 'candidate')!;
const idea: ConversationIdea = { context_key: 'context-v1', reason: identity.context.reason, opener: 'What would you like to grow on your balcony?', source: 'muse' };
const clients: QueryClient[] = [];
const makeClient = () => { const client = new QueryClient(); clients.push(client); return client; };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

describe('current conversation context', () => {
  it('requires an owner, Live, a current recommendation, and a nonempty context', () => {
    expect(conversationIdentity(undefined, true, [encounter], 'candidate')).toBeNull();
    expect(conversationIdentity('owner', false, [encounter], 'candidate')).toBeNull();
    expect(conversationIdentity('owner', true, [], 'candidate')).toBeNull();
    for (const status of ['pending', 'not_recommended', 'insufficient_evidence', 'unavailable'] as const) {
      expect(conversationIdentity('owner', true, [{ ...encounter, status }], 'candidate')).toBeNull();
    }
    expect(conversationIdentity('owner', true, [{ ...encounter, score: null }], 'candidate')).toBeNull();
    expect(conversationIdentity('owner', true, [{ ...encounter, conversation_context: undefined }], 'candidate')).toBeNull();
    expect(conversationIdentity('owner', true, [{ ...encounter, conversation_context: { ...identity.context, reason: ' ' } }], 'candidate')).toBeNull();
  });

  it('hides text from an old context and preserves honest fallback attribution', () => {
    expect(currentConversationIdea(null, idea)).toBeUndefined();
    expect(currentConversationIdea({ ...identity, context: { ...identity.context, key: 'context-v2' } }, idea)).toBeUndefined();
    expect(currentConversationIdea(identity, { ...idea, reason: 'A different reason.' })).toBeUndefined();
    expect(currentConversationIdea(identity, { ...idea, source: 'fallback' })?.source).toBe('fallback');
  });
});

describe('shared query lifecycle', () => {
  it('shares one pending request between the banner and card and reuses that context', async () => {
    const client = makeClient();
    const response = deferred<ConversationIdea>();
    const fetch = vi.fn(() => response.promise);
    const options = conversationIdeaOptions(identity, fetch);
    const banner = client.fetchQuery(options);
    const card = client.fetchQuery(options);
    expect(fetch).toHaveBeenCalledTimes(1);
    response.resolve(idea);
    expect(await banner).toEqual(idea);
    expect(await card).toEqual(idea);
    expect(await client.fetchQuery(options)).toEqual(idea);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(conversationIdeaKey({ ...identity, ownerId: 'another-owner' }))).toBeUndefined();
    expect(client.getQueryData(conversationIdeaKey({ ...identity, candidateId: 'another-candidate' }))).toBeUndefined();
  });

  it('does not cancel the card request when only the banner unmounts', async () => {
    const client = makeClient();
    const response = deferred<ConversationIdea>();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_identity, requestSignal: AbortSignal) => { signal = requestSignal; return response.promise; });
    const options = conversationIdeaOptions(identity, fetch);
    const banner = new QueryObserver(client, options);
    const card = new QueryObserver(client, options);
    const closeBanner = banner.subscribe(() => {});
    const closeCard = card.subscribe(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    closeBanner();
    expect(signal?.aborted).toBe(false);
    const pending = client.fetchQuery(options);
    response.resolve(idea);
    await pending;
    expect(card.getCurrentResult().data).toEqual(idea);
    closeCard();
  });

  it.each(['stop', 'expired', 'changed', 'declined', 'account'] as const)('cancels and removes a %s encounter without accepting a late result', async change => {
    const client = makeClient();
    const response = deferred<ConversationIdea>();
    let signal: AbortSignal | undefined;
    const pending = client.fetchQuery(conversationIdeaOptions(identity, (_identity, requestSignal) => {
      signal = requestSignal;
      return response.promise;
    })).catch(error => error);
    const current = change === 'expired' ? [] : change === 'changed'
      ? [{ ...encounter, conversation_context: { ...identity.context, key: 'context-v2' } }]
      : change === 'declined' ? [{ ...encounter, status: 'not_recommended' as const }] : [encounter];
    pruneConversationIdeas(client, change === 'account' ? 'another-owner' : 'owner', change !== 'stop', current);
    expect(signal?.aborted).toBe(true);
    response.resolve(idea);
    await pending;
    expect(client.getQueryData(conversationIdeaKey(identity))).toBeUndefined();
  });

  it('keeps an active result while removing a retired context and leaves other queries alone', () => {
    const client = makeClient();
    client.setQueryData(conversationIdeaKey(identity), idea);
    const retired = conversationIdeaKey({ ...identity, context: { ...identity.context, key: 'old-context' } });
    client.setQueryData(retired, { ...idea, context_key: 'old-context' });
    client.setQueryData(['me', 'owner'], { display_name: 'Owner' });
    pruneConversationIdeas(client, 'owner', true, [encounter]);
    expect(client.getQueryData(conversationIdeaKey(identity))).toEqual(idea);
    expect(client.getQueryData(retired)).toBeUndefined();
    expect(client.getQueryData(['me', 'owner'])).toEqual({ display_name: 'Owner' });
  });

  it('rejects a mismatched response and does not retry a failed generation', async () => {
    const client = makeClient();
    const fetch = vi.fn(async () => ({ ...idea, context_key: 'old-context' }));
    await expect(client.fetchQuery(conversationIdeaOptions(identity, fetch))).rejects.toThrow('conversation has changed');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(conversationIdeaKey(identity))).toBeUndefined();
  });
});
