import { describe, expect, it } from 'vitest';
import { starColor, starPosition, visibleStars, type StarNode } from './geometry';

describe('private constellation presentation', () => {
  it('keeps positions deterministic and on the sphere, independent of profile details', () => {
    for (let i=0; i<100; i++) {
      const point = starPosition(`request-${i}`);
      expect(point).toEqual(starPosition(`request-${i}`));
      expect(Math.hypot(...point)).toBeCloseTo(1.55);
    }
    expect(starPosition('request-1')).not.toEqual(starPosition('request-2'));
  });
  it('uses exact private preference states, not accept/decline decisions', () => {
    expect(starColor('liked')).toBe('#FFFFFF');
    expect(starColor('disliked')).toBe('#FF6D83');
    expect(starColor(null)).toBe('#BDA0F5');
  });
  it('filters the complete graph without mutating it or limiting to six cards', () => {
    const nodes: StarNode[] = Array.from({ length: 13 }, (_, i) => ({ request_id: `${i}`, display_name: 'Fictional', preference: i%2 ? 'disliked' : 'liked' }));
    expect(visibleStars(nodes, 'all')).toHaveLength(13);
    expect(visibleStars(nodes, 'liked')).toHaveLength(7);
    expect(visibleStars(nodes, 'disliked')).toHaveLength(6);
    expect(nodes).toHaveLength(13);
  });
});
