export type StarNode = { request_id: string; display_name: string; preference: 'liked' | 'disliked' | null };

export function starPosition(id: string): [number, number, number] {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  // Avalanche sequential fixture/request IDs so they do not cluster in one arc.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  const y = ((hash & 65535) / 65535) * 1.8 - .9;
  const angle = (hash >>> 16) / 65535 * Math.PI * 2;
  const ring = Math.sqrt(1-y*y);
  return [Math.cos(angle)*ring*1.55, y*1.55, Math.sin(angle)*ring*1.55];
}

export const starColor = (preference: StarNode['preference']) => preference === 'disliked' ? '#FF8D75' : preference === 'liked' ? '#FFE7A4' : '#FCB187';

export function visibleStars(nodes: StarNode[], filter: 'all' | 'liked' | 'disliked') {
  return filter === 'all' ? nodes : nodes.filter(node => node.preference === filter);
}
