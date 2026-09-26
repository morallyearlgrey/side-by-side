import { queryOptions } from '@tanstack/react-query';
import type { MatchDescriptionResult, MatchTarget, Preview } from '../../lib/types';

export type DescriptionIdentity = { ownerId: string; target: MatchTarget; previewKey: string };
type FetchDescription = (identity: DescriptionIdentity, signal: AbortSignal) => Promise<MatchDescriptionResult>;

export function descriptionIdentity(ownerId: string, target: MatchTarget, ownPreview: Preview | null | undefined, peerPreview: Preview | null | undefined): DescriptionIdentity | null {
  if (!ownPreview?.enabled || !peerPreview || peerPreview.enabled === false) return null;
  return { ownerId, target, previewKey: JSON.stringify([ownPreview, peerPreview]) };
}

export function matchDescriptionKey({ ownerId, target, previewKey }: DescriptionIdentity) {
  return ['descriptions', ownerId, target, previewKey] as const;
}

export function matchDescriptionOptions(identity: DescriptionIdentity, fetchDescription: FetchDescription) {
  return queryOptions({
    queryKey: matchDescriptionKey(identity),
    queryFn: ({ signal }) => fetchDescription(identity, signal),
    // Card and popup share one request. The server caches/coalesces generation;
    // one-minute revalidation checks permission and catalog cancellations.
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    gcTime: 0,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}
