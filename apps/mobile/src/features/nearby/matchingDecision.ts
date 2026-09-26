import type { Encounter } from '../../lib/types';

export function recommendedEncounters(encounters: Encounter[]) {
  return encounters.filter(encounter => encounter.status === 'recommend' && encounter.candidate_id && encounter.preview &&
    encounter.score !== null && Number.isFinite(encounter.score) && encounter.score >= 0 && encounter.score <= 1)
    .sort((left, right) => (right.score! - left.score!) || left.candidate_id!.localeCompare(right.candidate_id!));
}
