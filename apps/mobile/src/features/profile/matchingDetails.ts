import type { Fact, UserSettings } from '../../lib/types';

export function unmatchedTopics(settings: UserSettings, facts: Fact[]) {
  const approved = new Set(facts.filter(f => f.confirmation === 'confirmed' && f.matching_allowed).map(f => f.topic.trim().toLowerCase()));
  const topics = new Map<string, string>();
  for (const topic of [...settings.skills, ...settings.interests]) {
    const key = topic.trim().toLowerCase();
    if (key && !approved.has(key)) topics.set(key, topic.trim());
  }
  return [...topics.values()];
}

export function approvedDetail(topic: string, details: string, relationship: Fact['relationship'], answerId: string, factId: string): Fact {
  return { fact_id: factId, topic: topic.trim(), details: details.trim(), relationship,
    evidence: [{ source_type: 'onboarding_answer', reference_id: answerId, channel: 'self_report', support: details.trim() }],
    confirmation: 'confirmed', matching_allowed: true, sharing_scope: 'matching_only' };
}

export function profileSettingsForSave(settings: UserSettings) {
  const { discoverable: _discoverable, bluetooth_enabled: _bluetooth, ...profile } = settings;
  return profile;
}
