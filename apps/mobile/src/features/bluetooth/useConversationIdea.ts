import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ConversationIdea } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBluetooth } from './BluetoothProvider';
import { conversationIdentity, conversationIdeaOptions, currentConversationIdea, type ConversationIdentity } from './conversationIdeaQuery';

const fetchIdea = (identity: ConversationIdentity, signal: AbortSignal) => api<ConversationIdea>('/v1/ble/conversation-ideas', {
  method: 'POST',
  body: { candidate_id: identity.candidateId, context_key: identity.context.key },
  expectedUserId: identity.ownerId,
  signal,
});

export function useConversationIdea(candidateId: string) {
  const { session } = useAuth();
  const { state, encounters } = useBluetooth();
  const identity = conversationIdentity(session?.user.id, state.live, encounters, candidateId);
  const query = useQuery(conversationIdeaOptions(identity, fetchIdea));
  return {
    context: identity?.context,
    idea: currentConversationIdea(identity, query.data),
    loading: !!identity && query.isFetching,
    unavailable: !!identity && (query.isError || query.isPaused),
  };
}
