import type { QueryClient } from '@tanstack/react-query';

/** Discard profile reads that may have observed the previous Bluetooth setting. */
export async function registerBleSession<T>(
  queries: QueryClient,
  owner: string,
  register: () => Promise<T>,
): Promise<T> {
  const profile = { queryKey: ['me', owner] };
  await queries.cancelQueries(profile);
  const session = await register();
  // Focus/invalidation may have begun another read during registration. Cancel
  // that request before the controller treats newly received profiles as current.
  await queries.cancelQueries(profile);
  return session;
}
