import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { registerBleSession } from './registerBleSession';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe('Bluetooth registration and profile refresh', () => {
  it('prevents old reads before and during registration from overwriting a live profile', async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const queryKey = ['me', 'A'];
    queries.setQueryData(queryKey, { bluetooth_enabled: false });
    const before = deferred<{ bluetooth_enabled: boolean }>();
    const during = deferred<{ bluetooth_enabled: boolean }>();
    const registered = deferred<void>();
    const entered = deferred<void>();
    let beforeSignal: AbortSignal | undefined;
    let duringSignal: AbortSignal | undefined;
    const firstRead = queries.fetchQuery({ queryKey, queryFn: ({ signal }) => {
      beforeSignal = signal;
      return before.promise;
    } }).catch(() => {});

    const registration = registerBleSession(queries, 'A', async () => {
      entered.resolve();
      await registered.promise;
      return { token: 'fresh' };
    });
    await entered.promise;
    expect(beforeSignal?.aborted).toBe(true);

    const secondRead = queries.fetchQuery({ queryKey, queryFn: ({ signal }) => {
      duringSignal = signal;
      return during.promise;
    } }).catch(() => {});
    registered.resolve();
    expect(await registration).toEqual({ token: 'fresh' });
    expect(duringSignal?.aborted).toBe(true);
    const fresh = { bluetooth_enabled: true };
    queries.setQueryData(queryKey, fresh);
    before.resolve({ bluetooth_enabled: false });
    during.resolve({ bluetooth_enabled: false });
    await Promise.all([firstRead, secondRead]);
    expect(queries.getQueryData(queryKey)).toEqual(fresh);
    queries.clear();
  });
});
