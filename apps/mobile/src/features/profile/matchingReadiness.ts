import type { Preview, ProfileDraft, UserSettings } from '../../lib/types';
import { canConfirmConversationRequest, currentConversationRequest } from './conversationRequest';
import { needsBoundaryReview } from './topicBoundaries';

export function matchingReadiness(profile: ProfileDraft | null, settings: UserSettings, preview: Preview | null, consent: boolean) {
  const request = profile ? currentConversationRequest(profile.conversation_request, settings.matching_context, profile.current_goal) : null;
  const checks = [
    { id: 'profile', label: 'Saved profile', ready: !!profile },
    { id: 'request', label: 'Confirmed conversation goal and experience preference', ready: !!request && canConfirmConversationRequest(request) && request.evidence_requirement.confirmation === 'confirmed' },
    { id: 'facts', label: 'At least one approved matching detail', ready: !!profile?.facts.some(f => f.confirmation === 'confirmed' && f.matching_allowed && f.evidence.length > 0) },
    { id: 'topics', label: 'Topics you are open to discussing', ready: !!profile?.open_to_discussing.some(topic => topic.trim()) },
    { id: 'preview', label: 'Enabled nearby preview with a name', ready: !!preview?.enabled && !!preview.display_name.trim() },
    { id: 'consent', label: 'Your permission to use approved details for matching', ready: consent },
  ];
  const boundaryReview = needsBoundaryReview(profile?.avoid_topics ?? []);
  return { checks, boundaryReview, ready: checks.every(check => check.ready) && !boundaryReview };
}
