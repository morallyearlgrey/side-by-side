import { expect, it, vi } from 'vitest';
import { createEmailLinkCompleter } from './completeEmailLink';

it('exchanges a single-use code only once when a callback effect runs twice', async () => {
  const exchange = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'A' } }, redirectType: null }, error: null });
  const complete = createEmailLinkCompleter(exchange);
  const first = complete('sidebyside://auth/callback?code=test-code');
  const replay = complete('sidebyside://auth/callback?code=test-code');
  expect(first).toBe(replay);
  expect(await first).toEqual({ status: 'ready', recovery: false, userId: 'A' });
  expect(exchange).toHaveBeenCalledTimes(1);
});

it('offers password sign-in for a missing verifier without claiming verification succeeded', async () => {
  const exchange = vi.fn().mockResolvedValue({ data: { session: null }, error: { code: 'pkce_code_verifier_not_found', message: 'Internal details' } });
  const result = await createEmailLinkCompleter(exchange)('http://localhost:8081/auth/callback?code=test-code');
  expect(result).toMatchObject({ status: 'error', title: 'Finish signing in.' });
  if (result.status === 'error') expect(result.message).toContain('may already be confirmed');
});

it('shows password recovery only when the successful exchange identifies that flow', async () => {
  const exchange = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'A' } }, redirectType: 'recovery' }, error: null });
  expect(await createEmailLinkCompleter(exchange)('sidebyside://auth/callback?code=test-code&sb_flow_id=test-flow'))
    .toEqual({ status: 'ready', recovery: true, userId: 'A' });
  expect(exchange).toHaveBeenCalledWith('test-code', { flowId: 'test-flow' });
});

it('rejects incomplete or rejected links without exchanging a code', async () => {
  const exchange = vi.fn();
  const complete = createEmailLinkCompleter(exchange);
  expect(await complete('not-a-url')).toMatchObject({ status: 'error' });
  expect(await complete('sidebyside://auth/callback?error=access_denied')).toMatchObject({ status: 'error' });
  expect(exchange).not.toHaveBeenCalled();
});

it('turns network failures into a recoverable state', async () => {
  const exchange = vi.fn().mockRejectedValue(new TypeError('Network failed'));
  expect(await createEmailLinkCompleter(exchange)('sidebyside://auth/callback?code=test-code'))
    .toMatchObject({ status: 'error', title: 'We couldn’t connect.' });
});
