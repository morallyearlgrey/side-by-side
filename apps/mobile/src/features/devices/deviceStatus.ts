export type Headset = {
  device_id: string;
  label: string;
  revoked_at: string | null;
  lease_expires_at: string | null;
  owner_lease_expires_at: string | null;
  effective_state: 'offline' | 'revoked' | 'connected_unknown' | 'connected_not_worn' | 'ar_unavailable' | 'ar_ready';
};

export function headsetStatus(device: Headset, now: number, failed = false): Headset['effective_state'] {
  if (device.revoked_at || device.effective_state === 'revoked') return 'revoked';
  if (failed || !device.lease_expires_at || !device.owner_lease_expires_at ||
      !(Date.parse(device.lease_expires_at) > now) || !(Date.parse(device.owner_lease_expires_at) > now)) return 'offline';
  return device.effective_state;
}
