import type { QueryClient } from '@tanstack/react-query';
import type { Me } from '../../lib/types';

/** Publish a confirmed setting without letting an older profile poll undo it. */
export async function updatePresenceSetting(
  queries: QueryClient,
  owner: string,
  enabled: boolean,
  patch: () => Promise<unknown>,
  isCurrent: () => boolean,
): Promise<boolean> {
  const queryKey = ['me', owner];
  await queries.cancelQueries({ queryKey });
  if (!isCurrent()) return false;
  await patch();
  // A periodic/focus read can start while the mutation is in flight.
  await queries.cancelQueries({ queryKey });
  if (!isCurrent()) return false;
  const current = queries.getQueryData<Me>(queryKey);
  // A local consent revocation takes precedence over a late enable response.
  if (enabled && current?.matching_consent === false) return false;
  queries.setQueryData<Me>(queryKey, me => me && me.profile.user_id === owner ? {
    ...me,
    profile: { ...me.profile, discoverable: enabled, settings: { ...me.profile.settings, discoverable: enabled } },
  } : me);
  return true;
}
