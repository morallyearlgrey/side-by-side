import { ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Body, Button, Label, Notice } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import type { MatchTarget } from '@/lib/types';

type Description = { status: 'ready'; provider: 'Muse'; description: string; conversation_starter: string } | { status: 'unavailable' | 'error'; message: string };
export function MatchDescription({ target }: { target: MatchTarget }) {
  const { session } = useAuth();
  const query = useQuery({ queryKey: ['descriptions', session?.user.id, target],
    queryFn: ({ signal }) => api<Description>('/v1/matches/description', { method: 'POST', body: target, signal, expectedUserId: session?.user.id }),
    refetchInterval: 10_000, retry: false, gcTime: 0 });
  if (query.isPending) return <><ActivityIndicator /><Body muted>Muse is checking the approved shared topic.</Body></>;
  if (query.error) return <Notice error>{errorMessage(query.error)}</Notice>;
  if (query.data?.status !== 'ready') return <><Notice>{query.data?.message || 'Muse is unavailable.'}</Notice>{query.data?.status === 'error' && <Button title="Retry Muse" icon="refresh-outline" variant="quiet" onPress={() => void query.refetch()} />}</>;
  return <><Label>Muse</Label><Body>{query.data.description}</Body><Label>Conversation starter</Label><Body>{query.data.conversation_starter}</Body><Body muted>A shared approved topic, not a claim of mutual acceptance or a compatibility guarantee.</Body></>;
}
