import type { BleEncounter, BleState } from '../../../modules/nearby-ble';
import type { Encounter } from '../../lib/types';

type ServerSession = { token: string; expires_at: string };
type Ports = {
  native: { getState(): Promise<BleState>; start(token: string): Promise<BleState>; stop(): Promise<BleState> };
  create(owner: string): Promise<ServerSession>;
  revoke(owner: string): Promise<unknown>;
  encounter(owner: string, event: BleEncounter): Promise<Encounter>;
  appState(): string;
  state(value: BleState): void;
  busy(value: boolean): void;
  error(value: string): void;
  result(value: Encounter): void;
  remove(candidateId: string): void;
  clear(): void;
  changed(): void;
};

const activeStatuses = new Set(['starting', 'live']);
// A peer can be read every 30s, but its token emits only every 45s. Together
// those gates make repeat observations arrive about 60s apart, plus GATT time.
// Match the server's two-minute freshness window so a still-nearby peer does
// not disappear between those readings. A departed peer still expires.
export const ENCOUNTER_TTL_MS = 120_000;
type Observation = { candidateId?: string; timer?: ReturnType<typeof setTimeout> };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Bluetooth could not connect. Please try again.';

/** Coordinates radio and authenticated sessions. UI state never acts as a lock. */
export class BleSessionController {
  private owner: string | undefined;
  private generation = 0;
  private wanted = false;
  private radioRequested = false;
  private queue = Promise.resolve();
  private renewal: ReturnType<typeof setTimeout> | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private serverIssuedAt = 0;
  private encounterRequests = 0;
  private observations = new Map<string, Observation>();

  constructor(private ports: Ports) {}

  belongsTo(owner: string | undefined): boolean { return owner === this.owner; }

  private current(generation: number, owner: string) {
    return this.wanted && generation === this.generation && owner === this.owner;
  }

  private serialize(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  private clearTimers() {
    clearTimeout(this.renewal);
    clearTimeout(this.expiry);
    this.renewal = undefined;
    this.expiry = undefined;
  }

  setOwner(owner: string | undefined) {
    if (owner === this.owner) return;
    const previous = this.owner;
    this.owner = owner;
    this.ports.clear();
    this.ports.error('');
    // The API refuses a different current account; an old session then expires.
    void this.stopFor(previous);
  }

  async start(): Promise<void> {
    const owner = this.owner;
    if (!owner || this.wanted || this.ports.appState() !== 'active') return;
    const generation = ++this.generation;
    this.wanted = true;
    this.ports.busy(true);
    this.ports.error('');
    try {
      const availability = await this.ports.native.getState();
      if (!this.current(generation, owner)) return;
      this.ports.state(availability);
      if (!availability.available) throw new Error(availability.message || 'Bluetooth needs the native iPhone development build.');
      await this.serialize(() => this.activate(generation, owner));
      if (this.current(generation, owner)) this.ports.changed();
    } catch (error) {
      if (this.current(generation, owner)) {
        this.ports.error(errorText(error));
        await this.stop();
      }
    } finally {
      if (generation === this.generation) this.ports.busy(false);
    }
  }

  private async activate(generation: number, owner: string): Promise<void> {
    if (!this.current(generation, owner) || this.ports.appState() === 'background') return;
    const session = await this.ports.create(owner);
    // Stop is already queued behind this operation to revoke a late token.
    if (!this.current(generation, owner)) return;
    const expiresAt = Date.parse(session.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt - Date.now() < 10_000) {
      throw new Error('Your discovery session expired. Please turn Live on again.');
    }
    this.serverIssuedAt = Date.now();
    this.radioRequested = true;
    const state = await this.ports.native.start(session.token);
    if (!this.current(generation, owner)) return;
    this.ports.state(state);
    if (!activeStatuses.has(state.status)) throw new Error(state.message || 'Check your phone’s Bluetooth permissions.');
    const remaining = expiresAt - Date.now();
    if (remaining < 10_000) throw new Error('Your discovery session expired. Please turn Live on again.');
    this.clearTimers();
    this.expiry = setTimeout(() => {
      if (!this.current(generation, owner)) return;
      this.ports.error('The discovery session expired. Turn Live on to reconnect.');
      void this.stop();
    }, remaining);
    this.renewal = setTimeout(() => {
      void this.serialize(() => this.activate(generation, owner)).catch(error => {
        if (!this.current(generation, owner)) return;
        this.ports.error(errorText(error));
        void this.stop();
      });
    }, Math.min(90_000, Math.max(5_000, remaining * 0.7)));
  }

  stop(): Promise<void> { return this.stopFor(this.owner); }

  private stopFor(owner: string | undefined): Promise<void> {
    this.wanted = false;
    this.radioRequested = false;
    this.serverIssuedAt = 0;
    const generation = ++this.generation;
    this.clearTimers();
    for (const observation of this.observations.values()) clearTimeout(observation.timer);
    this.observations.clear();
    this.ports.busy(false);
    this.ports.clear();
    // Stop radio immediately; enqueue cleanup before a rapid new start can pass it.
    const radio = this.ports.native.stop().then(state => {
      if (generation === this.generation) this.ports.state(state);
    }).catch(() => {});
    return this.serialize(async () => {
      await radio;
      if (owner) {
        try { await this.ports.revoke(owner); }
        catch {
          if (generation === this.generation && owner === this.owner) {
            this.ports.error('Bluetooth is off on this phone. The server session will expire shortly.');
          }
        }
      }
      if (generation === this.generation) this.ports.changed();
    });
  }

  handleState(state: BleState) {
    if (this.wanted && !this.radioRequested) return;
    if (!this.wanted && activeStatuses.has(state.status)) return;
    this.ports.state(state);
    if (this.wanted && !activeStatuses.has(state.status)) {
      if (state.message) this.ports.error(state.message);
      void this.stop();
    }
  }

  handleAppState(state: string) {
    // iOS is inactive during permission dialogs. Those must not cancel Live.
    // An idle radio has no new cleanup to schedule. In particular, a stop
    // already queued behind registration must finish once, even if the app
    // receives another background event while its revoke request is pending.
    if (state === 'background' && this.wanted) void this.stop();
  }

  acceptRemoteState(updatedAt: number, consent: boolean | undefined, enabled: unknown) {
    if (this.wanted && this.serverIssuedAt > 0 && updatedAt > this.serverIssuedAt &&
      (consent === false || enabled === false)) void this.stop();
  }

  async handleEncounter(event: BleEncounter) {
    const owner = this.owner;
    if (!this.wanted || !this.radioRequested || !owner || this.encounterRequests >= 4) return;
    const generation = this.generation;
    const previous = this.observations.get(event.identifier);
    clearTimeout(previous?.timer);
    const observation: Observation = { candidateId: previous?.candidateId };
    this.observations.set(event.identifier, observation);
    const forget = () => {
      if (this.observations.get(event.identifier) !== observation) return;
      clearTimeout(observation.timer);
      if (observation.candidateId) this.ports.remove(observation.candidateId);
      this.observations.delete(event.identifier);
    };
    observation.timer = setTimeout(forget, ENCOUNTER_TTL_MS);
    // Bound tracking state even in a crowded venue.
    if (this.observations.size > 40) {
      const [key, oldest] = this.observations.entries().next().value!;
      clearTimeout(oldest.timer);
      if (oldest.candidateId) this.ports.remove(oldest.candidateId);
      this.observations.delete(key);
    }
    this.encounterRequests++;
    try {
      const result = await this.ports.encounter(owner, event);
      if (!this.current(generation, owner) || this.observations.get(event.identifier) !== observation) return;
      // A successful fresh exchange recovers from an earlier transient HTTP
      // error. Otherwise the UI continues reporting a broken connection even
      // after it has received a supported recommendation.
      this.ports.error('');
      if (observation.candidateId && observation.candidateId !== result.candidate_id) this.ports.remove(observation.candidateId);
      if (result.candidate_id && result.preview) {
        observation.candidateId = result.candidate_id;
        this.ports.result(result);
      } else forget();
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      if (this.current(generation, owner) && this.observations.get(event.identifier) === observation) {
        forget();
        if (status !== 404) this.ports.error(errorText(error));
      }
    } finally { this.encounterRequests--; }
  }
}
