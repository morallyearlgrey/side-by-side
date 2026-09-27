import type { Preview, ProfileDraft, UserSettings } from '@/lib/types';
import { canConfirmConversationRequest, currentConversationRequest } from './conversationRequest';

export function requiredProfileDetails(draft: ProfileDraft, settings: UserSettings, preview: Preview, showPreview: boolean): string[] {
  const missing: string[] = [];
  if (!settings.display_name.trim()) missing.push('Enter your name in About you.');
  if (!draft.current_goal.trim()) missing.push('Describe what you are exploring right now.');
  const request = currentConversationRequest(draft.conversation_request, settings.matching_context, draft.current_goal);
  if (draft.current_goal.trim() && (!canConfirmConversationRequest(request) || request?.evidence_requirement.confirmation !== 'confirmed')) {
    missing.push('Choose and confirm what would make this conversation useful.');
  }
  if (!draft.open_to_discussing.some(topic => topic.trim())) missing.push('Add at least one topic you are happy to discuss.');
  if (!draft.facts.some(fact => fact.confirmation === 'confirmed' && fact.matching_allowed && fact.evidence.length > 0)) {
    missing.push('Approve at least one matching detail about yourself.');
  }
  if (showPreview && preview.enabled && !preview.display_name.trim()) missing.push('Add a nearby preview name or turn off the preview.');
  return missing;
}
