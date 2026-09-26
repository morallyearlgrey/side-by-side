import { describe, expect, it } from 'vitest';
import { emptyDraft, emptySettings, type ProfileDraft } from '../../lib/types';
import { approvedDetail } from './matchingDetails';
import { matchingReadiness } from './matchingReadiness';

const profile: ProfileDraft = { ...emptyDraft, current_goal: 'Explore Italy', open_to_discussing: ['Italy'],
  facts: [approvedDetail('Italy', 'I want to visit Italy', 'wants_to_try', 'answer', 'fact')],
  conversation_request: { mode: 'casual_chat', goal: 'Explore Italy', evidence_requirement: { version: 1, kind: 'none', subject: null, claim: null, confirmation: 'confirmed' } } };
const preview = { enabled: true, display_name: 'Bryan', interests: ['Italy'] };

describe('matching readiness', () => {
  it('does not require hardware or turn discovery on', () => {
    expect(matchingReadiness(profile, emptySettings, preview, true).ready).toBe(true);
    expect(emptySettings.discoverable).toBe(false);
  });
  it('lists missing choices without silently granting them', () => {
    const result = matchingReadiness(emptyDraft, emptySettings, null, false);
    expect(result.ready).toBe(false);
    expect(result.checks.filter(c => !c.ready).map(c => c.id)).toEqual(['request', 'facts', 'topics', 'preview', 'consent']);
  });
  it('requires a current, confirmed conversation request', () => {
    expect(matchingReadiness({ ...profile, current_goal: 'A new goal' }, emptySettings, preview, true).ready).toBe(false);
    expect(matchingReadiness({ ...profile, conversation_request: null }, emptySettings, preview, true).ready).toBe(false);
  });
  it('keeps the boundary limitation explicit rather than ignoring a boundary', () => {
    const result = matchingReadiness({ ...profile, avoid_topics: ['politics'] }, emptySettings, preview, true);
    expect(result.boundaryReview).toBe(true);
    expect(result.ready).toBe(false);
  });
  it('does not count pending facts or an unnamed preview as ready', () => {
    expect(matchingReadiness({ ...profile, facts: [{ ...profile.facts[0], confirmation: 'pending' }] }, emptySettings, preview, true).ready).toBe(false);
    expect(matchingReadiness(profile, emptySettings, { ...preview, display_name: ' ' }, true).ready).toBe(false);
  });
});
