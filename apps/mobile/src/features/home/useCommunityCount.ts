import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';

export function useCommunityCount() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['community-count', userId],
    queryFn: ({ signal }) => api<{ users: number }>('/v1/community/count', { signal, expectedUserId: userId }),
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function communityCountLabel(count: number | undefined, error: boolean) {
  if (typeof count === 'number' && Number.isInteger(count) && count >= 0) {
    return `${count.toLocaleString()} ${count === 1 ? 'person has' : 'people have'} joined SidebySide`;
  }
  return error ? 'Community count unavailable' : 'Counting our community…';
}
