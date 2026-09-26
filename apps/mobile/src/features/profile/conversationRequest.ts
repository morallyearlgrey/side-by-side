import type { ConversationRequest, Mode } from '../../lib/types';

export function currentConversationRequest(request: ConversationRequest | null | undefined, mode: Mode, goal: string) {
  return request?.mode === mode && request.goal === goal ? request : null;
}

export function canConfirmConversationRequest(request: ConversationRequest | null) {
  if (!request || !request.goal.trim()) return false;
  const requirement = request.evidence_requirement;
  if (requirement.kind === 'none') return requirement.subject === null && requirement.claim === null;
  if (requirement.kind !== 'firsthand' || !request.goal.trim() || !requirement.claim?.trim() || !requirement.subject) return false;
  if (request.mode === 'learn') return requirement.subject === 'candidate' || requirement.subject === 'both';
  if (request.mode === 'share') return requirement.subject === 'viewer' || requirement.subject === 'both';
  return true;
}

export function changeConversationGoal<T extends { current_goal: string; conversation_request?: ConversationRequest | null }>(draft: T, goal: string): T {
  return goal === draft.current_goal ? draft : { ...draft, current_goal: goal, conversation_request: null };
}
