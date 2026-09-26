export type ReportedBadgeState = 'paused' | 'available' | 'offline' | 'revoked';
export type BadgeStatus = ReportedBadgeState | 'unavailable';
type BadgeSnapshot = {
  effective_state: ReportedBadgeState;
  revoked_at: string | null;
  lease_expires_at: string | null;
  last_seen_at: string | null;
};

/** A cached availability report cannot outlive its lease or prove a current state during an outage. */
export function badgeStatus(badge: BadgeSnapshot, now: number, refreshFailed: boolean): BadgeStatus {
  if (badge.revoked_at || badge.effective_state === 'revoked') return 'revoked';
  if (refreshFailed) return 'unavailable';
  const expires = badge.lease_expires_at ? Date.parse(badge.lease_expires_at) : NaN;
  if (!badge.last_seen_at || !Number.isFinite(expires) || expires <= now) return 'offline';
  return badge.effective_state;
}
