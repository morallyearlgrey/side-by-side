import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BleSessionController, ENCOUNTER_TTL_MS } from './BleSessionController';
import type { BleState } from '../../../modules/nearby-ble';
import type { Encounter } from '../../lib/types';

const idle: BleState = { available: true, live: false, status: 'idle', scanning: false, advertising: false };
const live: BleState = { ...idle, live: true, status: 'live', scanning: true, advertising: true };
const token = 'A'.repeat(43);
const event = { token, rssi: -60, identifier: 'local-peer', observedAt: '2026-01-01T00:00:00Z' };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

function setup() {
  const ports = {
    native: { getState: vi.fn(async () => idle), start: vi.fn(async (_token: string) => live), stop: vi.fn(async () => idle) },
    create: vi.fn(async (_owner: string) => ({ token, expires_at: new Date(Date.now() + 30_000).toISOString() })),
    revoke: vi.fn(async (_owner: string) => {}),
    encounter: vi.fn(async (_owner: string, _event: typeof event): Promise<Encounter> => ({ status: 'recommend', score: 0.8, candidate_id: 'B', preview: { display_name: 'B', interests: [] } })),
    appState: () => 'active',
    state: vi.fn(), busy: vi.fn(), error: vi.fn(), result: vi.fn(), remove: vi.fn(), clear: vi.fn(), changed: vi.fn(),
  };
  const controller = new BleSessionController(ports);
  controller.setOwner('A');
  return { controller, ports };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('Bluetooth session lifecycle', () => {
  it.each([404, 503])('removes an earlier preview after an encounter returns %s', async status => {
    const { controller, ports } = setup();
    await controller.start();
    await controller.handleEncounter(event);
    ports.encounter.mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { status }));
    await controller.handleEncounter(event);
    expect(ports.remove).toHaveBeenCalledWith('B');
  });

  it('removes an earlier preview when the server withdraws the preview', async () => {
    const { controller, ports } = setup();
    await controller.start();
    await controller.handleEncounter(event);
    ports.encounter.mockResolvedValueOnce({ status: 'insufficient_evidence', score: null });
    await controller.handleEncounter(event);
    expect(ports.remove).toHaveBeenCalledWith('B');
  });

  it('expires a departed peer even while the local radio renews', async () => {
    const { controller, ports } = setup();
    await controller.start();
    await controller.handleEncounter(event);
    await vi.advanceTimersByTimeAsync(ENCOUNTER_TTL_MS);
    expect(ports.remove).toHaveBeenCalledWith('B');
    expect(ports.create.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not restore a card from an older response or an expired request', async () => {
    const { controller, ports } = setup();
    await controller.start();
    const delayed = deferred<Encounter>();
    ports.encounter.mockReturnValueOnce(delayed.promise);
    const earlier = controller.handleEncounter(event);
    ports.encounter.mockRejectedValueOnce({ status: 404 });
    await controller.handleEncounter(event);
    delayed.resolve({ status: 'recommend', score: .8, candidate_id: 'B', preview: { display_name: 'B', interests: [] } });
    await earlier;
    expect(ports.result).not.toHaveBeenCalled();
    const late = deferred<Encounter>();
    ports.encounter.mockReturnValueOnce(late.promise);
    const pending = controller.handleEncounter(event);
    await vi.advanceTimersByTimeAsync(ENCOUNTER_TTL_MS);
    late.resolve({ status: 'recommend', score: .8, candidate_id: 'B', preview: { display_name: 'B', interests: [] } });
    await pending;
    expect(ports.result).not.toHaveBeenCalled();
  });

  it('a stop during availability lookup cannot later turn the radio on', async () => {
    const { controller, ports } = setup();
    const availability = deferred<BleState>();
    ports.native.getState.mockReturnValueOnce(availability.promise);
    const start = controller.start();
    await controller.stop();
    availability.resolve(idle);
    await start;
    expect(ports.create).not.toHaveBeenCalled();
    expect(ports.native.start).not.toHaveBeenCalled();
  });

  it('stops immediately during registration and revokes its late server token', async () => {
    const { controller, ports } = setup();
    const registration = deferred<{ token: string; expires_at: string }>();
    ports.create.mockReturnValueOnce(registration.promise);
    const start = controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const before = ports.native.stop.mock.calls.length;
    const stop = controller.stop();
    expect(ports.native.stop.mock.calls.length).toBe(before + 1);
    registration.resolve({ token, expires_at: new Date(Date.now() + 30_000).toISOString() });
    await Promise.all([start, stop]);
    expect(ports.native.start).not.toHaveBeenCalled();
    expect(ports.revoke).toHaveBeenLastCalledWith('A');
  });

  it('allows the iOS permission dialog but stops on background entry', async () => {
    const { controller, ports } = setup();
    await controller.start();
    const before = ports.native.stop.mock.calls.length;
    controller.handleAppState('inactive');
    expect(ports.native.stop.mock.calls.length).toBe(before);
    controller.handleAppState('background');
    expect(ports.native.stop.mock.calls.length).toBe(before + 1);
  });

  it('does not revoke an already idle session or report a background network error', async () => {
    const { controller, ports } = setup();
    await vi.advanceTimersByTimeAsync(0);
    ports.revoke.mockRejectedValue(new Error('Background network unavailable'));
    const stops = ports.native.stop.mock.calls.length;
    ports.error.mockClear();
    controller.handleAppState('background');
    controller.handleAppState('active');
    controller.handleAppState('background');
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.native.stop.mock.calls.length).toBe(stops);
    expect(ports.revoke).not.toHaveBeenCalled();
    expect(ports.error).not.toHaveBeenCalled();
  });

  it('lets an explicit stop finish once when the app backgrounds during revocation', async () => {
    const { controller, ports } = setup();
    await controller.start();
    const revoke = deferred<void>();
    ports.revoke.mockReturnValueOnce(revoke.promise);
    const stop = controller.stop();
    await vi.advanceTimersByTimeAsync(0);
    const stops = ports.native.stop.mock.calls.length;
    const revokes = ports.revoke.mock.calls.length;
    controller.handleAppState('background');
    controller.handleAppState('background');
    revoke.resolve(); await stop;
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.native.stop.mock.calls.length).toBe(stops);
    expect(ports.revoke.mock.calls.length).toBe(revokes);
    expect(ports.error).toHaveBeenLastCalledWith('');
  });

  it('still cancels registration on background and revokes a late-issued token', async () => {
    const { controller, ports } = setup();
    const registration = deferred<{ token: string; expires_at: string }>();
    ports.create.mockReturnValueOnce(registration.promise);
    const start = controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const stops = ports.native.stop.mock.calls.length;
    controller.handleAppState('background');
    controller.handleAppState('background');
    registration.resolve({ token, expires_at: new Date(Date.now() + 30_000).toISOString() });
    await start; await vi.advanceTimersByTimeAsync(0);
    expect(ports.native.stop.mock.calls.length).toBe(stops + 1);
    expect(ports.native.start).not.toHaveBeenCalled();
    expect(ports.revoke).toHaveBeenCalledExactlyOnceWith('A');
  });

  it('expires even when renewal hangs and never restarts from its late response', async () => {
    const { controller, ports } = setup();
    await controller.start();
    const renewal = deferred<{ token: string; expires_at: string }>();
    ports.create.mockReturnValueOnce(renewal.promise);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(ports.create).toHaveBeenCalledTimes(2);
    const before = ports.native.stop.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(ports.native.stop.mock.calls.length).toBe(before + 1);
    renewal.resolve({ token: 'B'.repeat(43), expires_at: new Date(Date.now() + 30_000).toISOString() });
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.native.start).toHaveBeenCalledTimes(1);
  });

  it('binds cleanup to the old account and hides late results after switching accounts', async () => {
    const { controller, ports } = setup();
    await controller.start();
    const response = deferred<Encounter>();
    ports.encounter.mockReturnValueOnce(response.promise);
    const encounter = controller.handleEncounter(event);
    controller.setOwner('C');
    response.resolve({ status: 'recommend', score: 0.8, candidate_id: 'B', preview: { display_name: 'Private old result', interests: [] } });
    await encounter;
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.result).not.toHaveBeenCalled();
    expect(ports.revoke).toHaveBeenLastCalledWith('A');
    expect(ports.encounter).toHaveBeenCalledWith('A', event);
  });

  it('orders rapid off/on so an old revoke cannot delete the new registration', async () => {
    const { controller, ports } = setup();
    await controller.start();
    const revoke = deferred<void>();
    ports.revoke.mockReturnValueOnce(revoke.promise);
    const stop = controller.stop();
    const start = controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.create).toHaveBeenCalledTimes(1);
    revoke.resolve();
    await Promise.all([stop, start]);
    expect(ports.create).toHaveBeenCalledTimes(2);
    expect(ports.native.start).toHaveBeenCalledTimes(2);
  });

  it('ignores cached off state but stops for fresh consent revocation', async () => {
    const { controller, ports } = setup();
    const beforeStart = Date.now() - 1;
    await controller.start();
    const before = ports.native.stop.mock.calls.length;
    controller.acceptRemoteState(beforeStart, true, false);
    expect(ports.native.stop.mock.calls.length).toBe(before);
    controller.acceptRemoteState(Date.now() + 1, false, true);
    expect(ports.native.stop.mock.calls.length).toBe(before + 1);
  });
});
