import type { Discovery } from '../../lib/types';

export const BANNER_MS = 5_000;
export const POPUP_MS = 60_000;
const MAX_QUEUE = 8;
const MAX_SEEN = 10_000;
const eventKey = /^[a-f0-9]{64}$/;

export class DiscoveryTimeline {
  readonly seen = new Map<string, number>();
  private items = new Map<string, Discovery>();
  private queue: string[] = [];
  private banner: { key: string; until: number } | null = null;
  private popup: { key: string; until: number } | null = null;
  private popupSeen = new Set<string>();
  constructor(private clock: () => number = Date.now, stored: [string, number][] = [], readonly scope = '') {
    for (const [key, time] of stored) {
      if (this.seen.size >= MAX_SEEN) break;
      if (eventKey.test(key) && Number.isFinite(time)) this.seen.set(key, time);
    }
  }
  receive(items: Discovery[]) {
    const now = this.clock();
    this.items.clear();
    for (const item of items) {
      const until = Date.parse(item.valid_until);
      if (item.status !== 'recommend' || !eventKey.test(item.event_key) || !Number.isFinite(until) || until <= now) continue;
      // Cards follow the latest server lease, independently of notification history.
      this.items.set(item.event_key, item);
      if (!this.seen.has(item.event_key) && this.seen.size < MAX_SEEN) {
        this.seen.set(item.event_key, now);
        if (this.queue.length < MAX_QUEUE) this.queue.push(item.event_key);
      }
      // At capacity keep fresh cards, but fail closed for automatic alerts rather
      // than evicting tombstones and replaying notifications after a reload.
    }
    return this.snapshot();
  }
  private eligible(key: string, now = this.clock()) {
    const item = this.items.get(key);
    return !!item && item.status === 'recommend' && Date.parse(item.valid_until) > now;
  }
  snapshot() {
    const now = this.clock();
    for (const key of this.items.keys()) if (!this.eligible(key, now)) this.items.delete(key);
    this.queue = this.queue.filter(key => this.eligible(key, now));
    if (this.banner && (this.banner.until <= now || !this.eligible(this.banner.key, now))) this.banner = null;
    if (!this.banner && this.queue.length) this.banner = { key: this.queue.shift()!, until: now + BANNER_MS };
    if (this.popup && (this.popup.until <= now || !this.eligible(this.popup.key, now))) this.popup = null;
    if (!this.popup && this.banner && !this.popupSeen.has(this.banner.key)) {
      this.popup = { key: this.banner.key, until: now + POPUP_MS };
      this.popupSeen.add(this.popup.key);
    }
    return { items: [...this.items.values()], banner: this.banner ? this.items.get(this.banner.key) || null : null,
      popup: this.popup ? this.items.get(this.popup.key) || null : null };
  }
  dismissBanner() { this.banner = null; return this.snapshot(); }
  dismissPopup() { this.popup = null; return this.snapshot(); }
  open(key: string) {
    const now = this.clock();
    if (this.eligible(key, now)) {
      this.popup = { key, until: now + POPUP_MS };
      this.popupSeen.add(key);
    }
    return this.snapshot();
  }
  hide() { this.items.clear(); this.queue = []; this.banner = null; this.popup = null; return this.snapshot(); }
  serialized() { return JSON.stringify([...this.seen]); }
}
