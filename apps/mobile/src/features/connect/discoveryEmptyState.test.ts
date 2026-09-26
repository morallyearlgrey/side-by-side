import { describe, expect, it } from 'vitest';
import { discoveryEmptyState } from './discoveryEmptyState';
import { matchingReadiness } from '../profile/matchingReadiness';
import { emptyDraft, emptySettings, type Encounter } from '../../lib/types';

const active = { discoveryOn: true, browserOnly: false, bluetoothLive: true, encounters: [] as Encounter[] };

describe('discovery empty state', () => {
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
