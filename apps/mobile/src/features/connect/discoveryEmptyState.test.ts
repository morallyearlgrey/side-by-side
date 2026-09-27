import { describe, expect, it } from 'vitest';
import { discoveryEmptyState } from './discoveryEmptyState';
import { matchingReadiness } from '../profile/matchingReadiness';
import { emptyDraft, emptySettings, type Encounter } from '../../lib/types';

const active = { discoveryOn: true, browserOnly: false, bluetoothLive: true, encounters: [] as Encounter[] };
const outcomes = { candidate_count: 1, pending_count: 0, insufficient_evidence_count: 0, not_recommended_count: 0, unavailable_count: 0 };

describe('discovery empty state', () => {
  it('explains completed location evidence checks instead of claiming there are no nearby profiles', () => {
    const result = discoveryEmptyState({ ...active, browserOnly: true, bluetoothLive: false,
      outcomes: { ...outcomes, insufficient_evidence_count: 1 } });
    expect(result.title).toBe('Nearby profiles found.');
    expect(result.message).toContain('approved details');
    expect(result.message).not.toContain('Bluetooth');
  });

  it('uses completed server results instead of a pending result from the last radio observation', () => {
    const result = discoveryEmptyState({ ...active, pending: 1, encounters: [{ status: 'pending', score: null }],
      outcomes: { ...outcomes, insufficient_evidence_count: 1 } });
    expect(result.title).toBe('Nearby profiles found.');
  });

  it('does not keep reporting a Bluetooth result after the server removes the eligible candidate', () => {
    const result = discoveryEmptyState({ ...active, encounters: [{ status: 'insufficient_evidence', score: null }],
      outcomes: { ...outcomes, candidate_count: 0 } });
    expect(result.title).toBe('No recommended matches yet.');
  });

  it('distinguishes a model failure and a completed non-recommendation from pending work', () => {
    expect(discoveryEmptyState({ ...active, outcomes: { ...outcomes, unavailable_count: 1 } }).title)
      .toBe('Matching is temporarily unavailable.');
    expect(discoveryEmptyState({ ...active, outcomes: { ...outcomes, not_recommended_count: 1 } }).title)
      .toBe('No recommended conversation yet.');
  });

  it('explains saved boundaries even while a nearby phone is being matched', () => {
    const readiness = matchingReadiness({ ...emptyDraft, avoid_topics: ['A private topic'] }, emptySettings, null, true);
    const result = discoveryEmptyState({ ...active, readiness, pending: 1 });
    expect(result.title).toBe('Match suggestions are paused.');
    expect(result.message).toContain('until the matching service can honor them');
    expect(result.message).not.toContain('A private topic');
  });

  it('directs incomplete request and approved-detail setup to the existing guidance', () => {
    const readiness = matchingReadiness(emptyDraft, emptySettings, null, true);
    expect(discoveryEmptyState({ ...active, readiness }).title).toBe('Your matching setup needs attention.');
  });

  it.each(['pending', 'insufficient_evidence'] as const)('keeps successful BLE detection visible for %s', status => {
    const result = discoveryEmptyState({ ...active, encounters: [{ status, score: null }] });
    expect(result.title).toBe('Nearby phone detected.');
    expect(result.message).not.toContain('No eligible people');
  });

  it('distinguishes a completed non-recommendation from failed discovery', () => {
    const result = discoveryEmptyState({ ...active, encounters: [{ status: 'not_recommended', score: 0.2 }] });
    expect(result.title).toBe('No recommended conversation yet.');
    expect(result.message).toContain('A nearby phone was detected.');
  });

  it('ignores stale BLE outcomes when only location discovery is active', () => {
    expect(discoveryEmptyState({ ...active, bluetoothLive: false, encounters: [{ status: 'insufficient_evidence', score: null }] }).title)
      .toBe('No recommended matches yet.');
  });

  it('prioritizes discovery off and service errors over profile guidance', () => {
    const readiness = matchingReadiness(emptyDraft, emptySettings, null, false);
    expect(discoveryEmptyState({ ...active, readiness, discoveryOn: false }).title).toBe('Discovery is off.');
    expect(discoveryEmptyState({ ...active, readiness, error: 'Network unavailable' }).title).toBe('Discovery needs attention.');
  });

  it('retains separate model-unavailable, pending, and browser-off guidance', () => {
    expect(discoveryEmptyState({ ...active, modelUnavailable: true }).title).toBe('Matching is temporarily unavailable.');
    expect(discoveryEmptyState({ ...active, pending: 1 }).title).toBe('Checking nearby matches…');
    expect(discoveryEmptyState({ ...active, browserOnly: true, discoveryOn: false }).message).not.toContain('Bluetooth');
  });
});
