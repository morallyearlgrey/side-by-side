import { describe, expect, it } from 'vitest';
import { emptySettings } from '../../lib/types';
import { approvedDetail, profileSettingsForSave, unmatchedTopics } from './matchingDetails';

describe('explicit matching details', () => {
  it('preserves exact evidence and the chosen relationship without inferring expertise', () => {
    const fact = approvedDetail(' Guitar ', ' I want to learn fingerstyle. ', 'interested', 'owned-answer', 'fact-id');
    expect(fact.relationship).toBe('interested');
    expect(fact.evidence[0]).toEqual({ source_type: 'onboarding_answer', reference_id: 'owned-answer', channel: 'self_report', support: 'I want to learn fingerstyle.' });
    expect(fact.confirmation).toBe('confirmed');
    expect(fact.matching_allowed).toBe(true);
    expect(fact.sharing_scope).toBe('matching_only');
  });
  it('surfaces saved interests missing an approved detail and deduplicates skills', () => {
    const settings = { ...emptySettings, skills: ['Guitar'], interests: ['guitar', 'Italy'] };
    const approved = approvedDetail('Guitar', 'I play fingerstyle', 'experienced', 'answer', 'fact');
    expect(unmatchedTopics(settings, [approved])).toEqual(['Italy']);
    expect(unmatchedTopics(settings, [{ ...approved, matching_allowed: false }])).toEqual(['guitar', 'Italy']);
  });
  it('never sends stale availability when saving a profile', () => {
    const saved = profileSettingsForSave({ ...emptySettings, display_name: 'Bryan', discoverable: true, bluetooth_enabled: true });
    expect(saved.display_name).toBe('Bryan');
    expect(saved).not.toHaveProperty('discoverable');
    expect(saved).not.toHaveProperty('bluetooth_enabled');
  });
  it('keeps private gender preferences in the profile save payload', () => {
    const saved = profileSettingsForSave({ ...emptySettings, gender_identity: 'man', gender_preferences: ['woman'] });
    expect(saved.gender_identity).toBe('man');
    expect(saved.gender_preferences).toEqual(['woman']);
  });
});
