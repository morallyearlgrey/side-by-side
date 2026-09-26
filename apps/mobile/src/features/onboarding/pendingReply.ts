import type { OnboardingSession } from '../../lib/types';

export type PendingReply = { message_id: string; content: string; skip: boolean };

// The server saves a turn before asking Muse. Reuse its ID after a failed reply,
// including across app restarts, so retrying never creates a second answer.
export function pendingReply(session?: Pick<OnboardingSession, 'turns'>): PendingReply | null {
  const turn = session?.turns.at(-1);
  if (!turn || turn.role !== 'user') return null;
  const skip = turn.content === '[Skipped]';
  return { message_id: turn.id, content: skip ? '' : turn.content, skip };
}
