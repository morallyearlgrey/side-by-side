import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './api';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { auth } }));
vi.mock('./config', () => ({ config: { apiUrl: 'https://api.sidebyside.test' } }));

beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'new-owner' }, access_token: 'test-token' } } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('does not send a queued old-account request with a new account token', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(api('/v1/ble/sessions', { method: 'DELETE', expectedUserId: 'old-owner' }))
    .rejects.toMatchObject({ status: 409, code: 'account_changed' });
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps a query cancelled while its auth lookup was pending', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    expect(options.signal?.aborted).toBe(true);
    throw new DOMException('Aborted', 'AbortError');
  });
  vi.stubGlobal('fetch', fetch);
  await expect(api('/v1/me', { signal: controller.signal, expectedUserId: 'new-owner' }))
    .rejects.toMatchObject({ status: 0 });
});

it('times out a stalled auth refresh and never sends its mutation when auth finally resolves', async () => {
  vi.useFakeTimers();
  let finishAuth!: (value: unknown) => void;
  auth.getSession.mockReturnValue(new Promise(resolve => { finishAuth = resolve; }));
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const request = api('/v1/settings', { method: 'PATCH', body: { discoverable: true }, timeoutMs: 1000 });
  const assertion = expect(request).rejects.toMatchObject({ status: 0 });
  await vi.advanceTimersByTimeAsync(1000);
  await assertion;
  finishAuth({ data: { session: { user: { id: 'new-owner' }, access_token: 'test-token' } } });
  await Promise.resolve(); await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
});

it('cancels promptly while auth is pending', async () => {
  auth.getSession.mockReturnValue(new Promise(() => {}));
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const request = api('/v1/presence', { method: 'PUT', signal: controller.signal });
  controller.abort();
  await expect(request).rejects.toMatchObject({ status: 0 });
  expect(fetch).not.toHaveBeenCalled();
});

it('bounds a response body that never finishes', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: () => new Promise(() => {}) }));
  const request = api('/v1/me', { timeoutMs: 1000 });
  const assertion = expect(request).rejects.toMatchObject({ status: 0 });
  await vi.advanceTimersByTimeAsync(1000);
  await assertion;
});
