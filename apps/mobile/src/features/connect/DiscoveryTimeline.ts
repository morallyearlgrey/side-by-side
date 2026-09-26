import type { Discovery } from '../../lib/types';

export const BANNER_MS = 5_000;
export const DISCOVERY_MS = 60_000;
const MAX_QUEUE = 8;

export class DiscoveryTimeline {
  readonly seen = new Map<string, number>();
  private items = new Map<string, Discovery>();
  private queue: string[] = [];
  private banner: { key: string; until: number } | null = null;
  private popup: string | null = null;
  private popupSeen = new Set<string>();
  constructor(private clock: () => number = Date.now, stored: [string, number][] = [], readonly scope = '') {
    for (const [key, time] of stored) if (/^[a-f0-9]{64}$/.test(key) && Number.isFinite(time)) this.seen.set(key, time);
  }
  receive(items: Discovery[]) {
    const now = this.clock();
    this.items.clear();
    for (const item of items) {
      if (item.status !== 'recommend' || Date.parse(item.valid_until) <= now) continue;
      if (!this.seen.has(item.event_key)) {
        // At capacity fail closed instead of evicting tombstones and replaying alerts.
        if (this.seen.size >= 10_000) continue;
        this.seen.set(item.event_key, now);
        if (this.queue.length < MAX_QUEUE) this.queue.push(item.event_key);
      }
      if (this.seen.get(item.event_key)! + DISCOVERY_MS > now) this.items.set(item.event_key, item);
    }
    return this.snapshot();
  }
  private eligible(key: string) {
    const item = this.items.get(key);
    return !!item && this.seen.get(key)! + DISCOVERY_MS > this.clock() && Date.parse(item.valid_until) > this.clock();
  }
  snapshot() {
    for (const key of this.items.keys()) if (!this.eligible(key)) this.items.delete(key);
    this.queue = this.queue.filter(key => this.eligible(key));
    if (this.banner && (this.banner.until <= this.clock() || !this.eligible(this.banner.key))) this.banner = null;
    if (!this.banner && this.queue.length) this.banner = { key: this.queue.shift()!, until: this.clock() + BANNER_MS };
    if (this.popup && !this.eligible(this.popup)) this.popup = null;
    if (!this.popup && this.banner && !this.popupSeen.has(this.banner.key)) {
      this.popup = this.banner.key;
      this.popupSeen.add(this.popup);
    }
    return { items: [...this.items.values()], banner: this.banner ? this.items.get(this.banner.key) || null : null,
      popup: this.popup ? this.items.get(this.popup) || null : null };
  }
  dismissBanner() { this.banner = null; return this.snapshot(); }
  dismissPopup() { this.popup = null; return this.snapshot(); }
  open(key: string) { if (this.eligible(key)) { this.popup = key; this.popupSeen.add(key); } return this.snapshot(); }
  hide() { this.items.clear(); this.queue = []; this.banner = null; this.popup = null; return this.snapshot(); }
  serialized() { return JSON.stringify([...this.seen]); }
}
