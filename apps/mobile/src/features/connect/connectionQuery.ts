export type ConnectionFilter = 'all' | 'liked' | 'disliked';
export function connectionPagePath(query: string, filter: ConnectionFilter, page: number) {
  return `/v1/connections/page?q=${encodeURIComponent(query)}&filter=${filter}&page=${Math.max(1, Math.floor(page))}`;
}
