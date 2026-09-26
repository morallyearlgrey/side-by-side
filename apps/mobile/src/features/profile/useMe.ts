import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthProvider';
export function useMe() {
  const { session } = useAuth();
  return useQuery({ queryKey: ['me', session?.user.id], queryFn: ({ signal }) => api<Me>('/v1/me', { signal, expectedUserId: session?.user.id }), enabled: !!session, refetchInterval: 10_000 });
}
