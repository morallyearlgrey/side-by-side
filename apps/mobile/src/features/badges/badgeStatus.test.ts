import { describe, expect, it } from 'vitest';
import { badgeStatus } from './badgeStatus';

const now = Date.parse('2026-09-26T09:00:00Z');
const active = {
  effective_state: 'available' as const,
  revoked_at: null,
  last_seen_at: new Date(now - 15_000).toISOString(),
  lease_expires_at: new Date(now + 30_000).toISOString(),
};

describe('badge status freshness', () => {
  it('expires a previously available snapshot at the exact lease boundary', () => {
    expect(badgeStatus(active, now + 29_999, false)).toBe('available');
    expect(badgeStatus(active, now + 30_000, false)).toBe('offline');
    expect(badgeStatus(active, now + 300_000, false)).toBe('offline');
  });

  it('does not present cached availability as current when refresh fails', () => {
    expect(badgeStatus(active, now, true)).toBe('unavailable');
    expect(badgeStatus({ ...active, effective_state: 'paused' }, now, true)).toBe('unavailable');
  });

  it('keeps final revocation ahead of connectivity and lease state', () => {
    expect(badgeStatus({ ...active, revoked_at: new Date(now).toISOString() }, now, true)).toBe('revoked');
    expect(badgeStatus({ ...active, effective_state: 'revoked' }, now + 90_000, false)).toBe('revoked');
  });

  it('treats unreported or invalid lease snapshots as offline', () => {
    expect(badgeStatus({ ...active, last_seen_at: null }, now, false)).toBe('offline');
    expect(badgeStatus({ ...active, lease_expires_at: null }, now, false)).toBe('offline');
    expect(badgeStatus({ ...active, lease_expires_at: 'invalid' }, now, false)).toBe('offline');
  });

  it('preserves a fresh paused report and a server-reported offline state', () => {
    expect(badgeStatus({ ...active, effective_state: 'paused' }, now, false)).toBe('paused');
    expect(badgeStatus({ ...active, effective_state: 'offline' }, now, false)).toBe('offline');
  });
});
