import { describe, expect, it } from 'vitest';
import type { ActivitySuggestion } from '../../lib/types';
import { activitySchedule, activitySourceUrl, currentActivitySuggestions } from './activityPresentation';

const now = Date.parse('2026-09-26T12:00:00Z');
const activity: ActivitySuggestion = {
  id: 'park', title: 'A park walk', summary: 'Take a walk together.', venue: 'Park', area: 'Atlanta', tags: ['walking'],
  cost: 'free', cost_note: 'Free admission; check parking.', eligibility: 'public', eligibility_note: 'Open to the public.',
  duration_minutes: 30, indoor: false, source_url: 'https://example.org/park', source_name: 'Park source',
  source_checked_at: '2026-09-26T10:00:00Z', review_after: '2026-10-26T00:00:00Z',
  kind: 'evergreen', starts_at: null, ends_at: null, status: 'active', invitation: 'Would you like to walk together?', reason: 'A general activity idea.', basis: 'general_activity',
};

describe('activity details', () => {
  it('hides cancelled, expired, unchecked and unsafe activity records', () => {
    expect(currentActivitySuggestions([activity], now)).toEqual([activity]);
    for (const patch of [
      { status: 'cancelled' }, { review_after: '2026-09-01' }, { review_after: 'invalid' },
      { source_url: 'javascript:alert(1)' }, { kind: 'event' as const }, { kind: 'recurring' as const },
      { source_checked_at: '2026-10-01' },
      { kind: 'event' as const, starts_at: '2026-09-26T11:00:00Z', ends_at: '2026-09-26T13:00:00Z' },
      { kind: 'event' as const, starts_at: '2026-09-25T10:00:00Z', ends_at: '2026-09-25T12:00:00Z' },
    ]) expect(currentActivitySuggestions([{ ...activity, ...patch }], now)).toEqual([]);
  });

  it('keeps a future event and limits compact cards to two activities', () => {
    const event = { ...activity, kind: 'event' as const, starts_at: '2026-09-26T13:00:00Z', ends_at: '2026-09-26T14:00:00Z' };
    expect(currentActivitySuggestions([event], now)).toEqual([event]);
    expect(currentActivitySuggestions([activity, { ...activity, id: '2' }, { ...activity, id: '3' }], now)).toHaveLength(2);
  });

  it('only opens public web URLs without embedded credentials', () => {
    expect(activitySourceUrl('https://example.org/park')).toBe('https://example.org/park');
    for (const url of ['http://example.org', 'sidebyside://settings', 'tel:123', 'file:///private/file', 'https://user:secret@example.org', 'not a url']) expect(activitySourceUrl(url)).toBeNull();
  });

  it('never invents a date for an evergreen or recurring activity', () => {
    expect(activitySchedule(activity)).toBe('Choose a time together');
    expect(activitySchedule({ ...activity, kind: 'recurring' })).toBe('Check the next session');
    expect(activitySchedule({ ...activity, starts_at: '2026-09-26T19:00:00Z' })).toMatch(/Sep 26.*3:00 PM Atlanta time/);
  });
});
