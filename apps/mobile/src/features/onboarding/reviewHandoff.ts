import type { OnboardingSession } from '../../lib/types';

// Navigation only: facts and sharing permissions still require explicit review.
export function isReadyForProfileReview(session?: Pick<OnboardingSession, 'status' | 'ready_for_review'>) {
  return session?.status === 'awaiting_confirmation' || session?.ready_for_review === true;
}
