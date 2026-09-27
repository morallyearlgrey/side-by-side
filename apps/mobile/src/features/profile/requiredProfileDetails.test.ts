import { describe, expect, it } from 'vitest';
import { emptyDraft, emptySettings, type ProfileDraft } from '../../lib/types';
import { approvedDetail } from './matchingDetails';
import { requiredProfileDetails } from './requiredProfileDetails';

const complete: ProfileDraft = {
  ...emptyDraft,
  current_goal: 'Meet someone to talk about astronomy',
  open_to_discussing: ['astronomy'],
  facts: [approvedDetail('astronomy', 'I like spotting planets', 'interested', 'answer', 'fact')],
  conversation_request: {
    mode: 'casual_chat', goal: 'Meet someone to talk about astronomy',
    evidence_requirement: { version: 1, kind: 'none', subject: null, claim: null, confirmation: 'confirmed' },
  },
};
const settings = { ...emptySettings, display_name: 'Kai' };
const preview = { enabled: false, display_name: '', interests: [] };

describe('required matching profile details', () => {
  it('accepts a complete profile without forcing optional preview sharing', () => {
    expect(requiredProfileDetails(complete, settings, preview, true)).toEqual([]);
  });
  it('names each missing requirement and rejects stale or unconfirmed requests', () => {
    const incomplete = { ...complete, current_goal: 'Another goal', open_to_discussing: [], facts: [] };
    expect(requiredProfileDetails(incomplete, { ...settings, display_name: '' }, preview, false)).toEqual([
      'Enter your name in About you.',
      'Choose and confirm what would make this conversation useful.',
      'Add at least one topic you are happy to discuss.',
      'Approve at least one matching detail about yourself.',
    ]);
  });
  it('requires a name if someone explicitly enables nearby preview', () => {
    expect(requiredProfileDetails(complete, settings, { ...preview, enabled: true }, true))
      .toContain('Add a nearby preview name or turn off the preview.');
  });
});
