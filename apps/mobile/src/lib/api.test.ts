import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './api';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { auth } }));
vi.mock('./config', () => ({ config: { apiUrl: 'https://api.sidebyside.test' } }));

beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'new-owner' }, access_token: 'test-token' } } });
});
afterEach(() => vi.unstubAllGlobals());

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
