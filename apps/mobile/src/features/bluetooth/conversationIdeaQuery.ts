import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { BleConversationContext, ConversationIdea, Encounter } from '../../lib/types';
import { recommendedEncounters } from '../nearby/matchingDecision';

const prefix = 'ble-conversation-idea';
export type ConversationIdentity = { ownerId: string; candidateId: string; context: BleConversationContext };
type FetchIdea = (identity: ConversationIdentity, signal: AbortSignal) => Promise<ConversationIdea>;

export function conversationIdentity(ownerId: string | undefined, live: boolean, encounters: Encounter[], candidateId?: string): ConversationIdentity | null {
  if (!ownerId || !live || !candidateId) return null;
  const encounter = recommendedEncounters(encounters).find(item => item.candidate_id === candidateId);
  const context = encounter?.conversation_context;
  if (!context?.key.trim() || !context.reason.trim()) return null;
  return { ownerId, candidateId, context };
}

export function conversationIdeaKey(identity: ConversationIdentity) {
  return [prefix, identity.ownerId, identity.candidateId, identity.context.key] as const;
}

export function currentConversationIdea(identity: ConversationIdentity | null, idea: ConversationIdea | undefined) {
  return identity && idea?.context_key === identity.context.key && idea.reason === identity.context.reason &&
    !!idea.opener.trim() && (idea.source === 'muse' || idea.source === 'fallback') ? idea : undefined;
}

export function conversationIdeaOptions(identity: ConversationIdentity | null, fetchIdea: FetchIdea) {
  return queryOptions({
    queryKey: identity ? conversationIdeaKey(identity) : ['ble-conversation-idea-inactive'],
    enabled: !!identity,
    queryFn: async ({ signal }) => {
      if (!identity) throw new Error('This Bluetooth encounter is no longer active.');
      const idea = await fetchIdea(identity, signal);
      if (!currentConversationIdea(identity, idea)) throw new Error('This conversation has changed.');
      return idea;
    },
    // Mounted banner and card share one request for each versioned context.
    // If navigation removes the last observer, its HTTP request is cancelled;
    // the server coalesces that context so remounting does not rerun Muse.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

/** Retire requests and cached text as soon as their disclosure context disappears. */
export function pruneConversationIdeas(client: QueryClient, ownerId: string | undefined, live: boolean, encounters: Encounter[]) {
  const active = new Set(encounters.flatMap(encounter => {
    const identity = conversationIdentity(ownerId, live, encounters, encounter.candidate_id);
    return identity ? [JSON.stringify(conversationIdeaKey(identity))] : [];
  }));
  for (const query of client.getQueryCache().findAll({ queryKey: [prefix] })) {
    if (!active.has(JSON.stringify(query.queryKey))) client.removeQueries({ queryKey: query.queryKey, exact: true });
  }
}
