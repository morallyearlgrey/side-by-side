import type { ActivitySuggestion } from '../../lib/types';

export function activitySourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function currentActivitySuggestions(items: ActivitySuggestion[], now = Date.now()) {
  return items.filter(item => {
    const reviewAfter = Date.parse(item.review_after);
    const checkedAt = Date.parse(item.source_checked_at);
    if (item.status !== 'active' || !Number.isFinite(reviewAfter) || !Number.isFinite(checkedAt) || checkedAt > now || reviewAfter <= now || !activitySourceUrl(item.source_url)) return false;
    if (item.kind === 'event' || item.kind === 'recurring') {
      const start = Date.parse(item.starts_at || '');
      const end = Date.parse(item.ends_at || '');
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= now || end <= start) return false;
    } else if (item.starts_at || item.ends_at) return false;
    return true;
  }).slice(0, 2);
}

export function activitySchedule(item: ActivitySuggestion) {
  if (!item.starts_at) return item.kind === 'recurring' ? 'Check the next session' : 'Choose a time together';
  const date = new Date(item.starts_at);
  if (!Number.isFinite(date.getTime())) return 'Check the date with the source';
  return `${date.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} Atlanta time`;
}
