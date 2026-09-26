import { describe, expect, it } from 'vitest';
import { headsetStatus, type Headset } from './deviceStatus';

const now = Date.parse('2026-09-26T12:00:00Z');
const device: Headset = { device_id: 'test', label: 'Quest', revoked_at: null, effective_state: 'ar_ready',
  lease_expires_at: new Date(now + 15_000).toISOString(), owner_lease_expires_at: new Date(now + 30_000).toISOString() };
describe('headset lease display', () => {
  it('ages cached presence without a successful refresh', () => {
    expect(headsetStatus(device, now)).toBe('ar_ready');
    expect(headsetStatus(device, now + 15_000)).toBe('offline');
    expect(headsetStatus(device, now, true)).toBe('offline');
  });
  it('requires both independent leases and permanent revocation wins', () => {
    expect(headsetStatus({ ...device, owner_lease_expires_at: new Date(now).toISOString() }, now)).toBe('offline');
    expect(headsetStatus({ ...device, revoked_at: new Date(now).toISOString() }, now)).toBe('revoked');
    expect(headsetStatus({ ...device, owner_lease_expires_at: 'bad' }, now)).toBe('offline');
  });
  it('does not turn connected unknown or not-worn reports into readiness', () => {
    expect(headsetStatus({ ...device, effective_state: 'connected_unknown' }, now)).toBe('connected_unknown');
    expect(headsetStatus({ ...device, effective_state: 'connected_not_worn' }, now)).toBe('connected_not_worn');
  });
});
