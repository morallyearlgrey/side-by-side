import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptySettings, type Me } from '../../lib/types';
import { updatePresenceSetting } from './updatePresenceSetting';

const clients: QueryClient[] = [];
const profile = (enabled = false): Me => ({ profile: { user_id: 'A', display_name: 'Fictional A', current_profile_version_id: 'version',
  discoverable: enabled, settings: { ...emptySettings, discoverable: enabled } }, current_version: null, preview: null,
onboarding: null, readiness: {}, matching_consent: true });
function setup(enabled = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client); client.setQueryData(['me', 'A'], profile(enabled)); return client;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

describe('confirmed location setting', () => {
  it.each([true, false])('updates the switch immediately after successful PATCH to %s and rejects older polls', async enabled => {
    const client = setup(!enabled); const queryKey = ['me', 'A'];
    const before = deferred<Me>(); const during = deferred<Me>(); const patched = deferred<void>(); const entered = deferred<void>();
    let beforeSignal: AbortSignal | undefined; let duringSignal: AbortSignal | undefined;
    const firstRead = client.fetchQuery({ queryKey, queryFn: ({ signal }) => { beforeSignal = signal; return before.promise; } }).catch(() => {});
    const mutation = updatePresenceSetting(client, 'A', enabled, async () => { entered.resolve(); await patched.promise; }, () => true);
    await entered.promise;
    expect(beforeSignal?.aborted).toBe(true);
    expect(client.getQueryData<Me>(queryKey)?.profile.discoverable).toBe(!enabled);
    const secondRead = client.fetchQuery({ queryKey, queryFn: ({ signal }) => { duringSignal = signal; return during.promise; } }).catch(() => {});
    patched.resolve();
    expect(await mutation).toBe(true);
    expect(duringSignal?.aborted).toBe(true);
    expect(client.getQueryData<Me>(queryKey)?.profile).toMatchObject({ discoverable: enabled, settings: { discoverable: enabled } });
    before.resolve(profile(!enabled)); during.resolve(profile(!enabled));
    await Promise.all([firstRead, secondRead]);
    expect(client.getQueryData<Me>(queryKey)?.profile.discoverable).toBe(enabled);
  });
  it('keeps the previous state if the server rejects the change', async () => {
    const client = setup();
    await expect(updatePresenceSetting(client, 'A', true, async () => { throw new Error('Rejected'); }, () => true)).rejects.toThrow('Rejected');
    expect(client.getQueryData<Me>(['me', 'A'])?.profile.discoverable).toBe(false);
  });
  it('does not mutate after an operation has been retired', async () => {
    const client = setup(); const patch = vi.fn();
    expect(await updatePresenceSetting(client, 'A', true, patch, () => false)).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });
  it('does not undo a consent revocation that arrives while enabling', async () => {
    const client = setup();
    expect(await updatePresenceSetting(client, 'A', true, async () => {
      client.setQueryData(['me', 'A'], { ...profile(), matching_consent: false });
    }, () => true)).toBe(false);
    expect(client.getQueryData<Me>(['me', 'A'])).toMatchObject({ matching_consent: false, profile: { discoverable: false } });
  });
});
