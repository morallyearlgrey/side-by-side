import { describe, expect, it } from 'vitest';
import { canShowMeetup, hideMeetupPoints, type MeetupState } from './types';

const now = Date.UTC(2026, 8, 26, 10, 30);
const point = { latitude: 40.7128, longitude: -74.006, accuracy_m: 10, observed_at: new Date(now).toISOString() };
const active: MeetupState = { status: 'sharing', sharing: true, peer_sharing: true, share_id: 'own-lease', sharing_until: new Date(now + 900_000).toISOString(), valid_until: new Date(now + 20_000).toISOString(), me: point, peer: point };

describe('meetup map visibility', () => {
  it('requires mutual, fresh, unexpired sharing', () => {
    expect(canShowMeetup(active, now)).toBe(true);
    expect(canShowMeetup(null, now)).toBe(false);
    for (const patch of [{ sharing: false }, { peer_sharing: false }, { me: null }, { peer: null }, { valid_until: null }, { sharing_until: null }, { valid_until: 'invalid' }, { sharing_until: new Date(now).toISOString() }]) {
      expect(canShowMeetup({ ...active, ...patch }, now)).toBe(false);
    }
  });
  it.each(['off', 'waiting', 'stale', 'unavailable'] as const)('hides points in state %s even if an old response contains them', status => {
    expect(canShowMeetup({ ...active, status }, now)).toBe(false);
  });
  it('expires without another network response', () => {
    expect(canShowMeetup(active, now + 19_999)).toBe(true);
    expect(canShowMeetup(active, now + 20_000)).toBe(false);
  });
  it('clears coordinates but retains the lease needed to retry stopping', () => {
    const hidden = hideMeetupPoints(active)!;
    expect(hidden.me).toBeNull(); expect(hidden.peer).toBeNull(); expect(hidden.valid_until).toBeNull();
    expect(hidden.share_id).toBe(active.share_id);
    expect(canShowMeetup(hidden, now)).toBe(false);
    expect(active.me).toBe(point);
    expect(hideMeetupPoints(null)).toBeNull();
  });
});
