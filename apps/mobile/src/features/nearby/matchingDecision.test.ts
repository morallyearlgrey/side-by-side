import { expect, it } from 'vitest';
import type { Encounter } from '../../lib/types';
import { recommendedEncounters } from './matchingDecision';

it('never ranks an unsupported or negative decision even if it carries a numeric score', () => {
  const base = { score: .99, candidate_id: 'person', preview: { display_name: 'Synthetic', interests: [] } };
  const entries: Encounter[] = ['not_recommended', 'insufficient_evidence', 'unavailable', 'pending'].map(status => ({ ...base, status: status as Encounter['status'] }));
  expect(recommendedEncounters(entries)).toEqual([]);
});
it('sorts only complete, finite recommendations and keeps the original list unchanged', () => {
  const entries: Encounter[] = [
    { status: 'recommend', score: .7, candidate_id: 'b', preview: { display_name: 'B', interests: [] } },
    { status: 'recommend', score: .9, candidate_id: 'a', preview: { display_name: 'A', interests: [] } },
    { status: 'recommend', score: Number.NaN, candidate_id: 'invalid', preview: { display_name: 'Invalid', interests: [] } },
    { status: 'recommend', score: .95, candidate_id: 'private' },
  ];
  expect(recommendedEncounters(entries).map(item => item.candidate_id)).toEqual(['a', 'b']);
  expect(entries[0].candidate_id).toBe('b');
});
