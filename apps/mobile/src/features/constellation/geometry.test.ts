import { describe, expect, it } from 'vitest';
import { historicalStars, starColor, starPosition, visibleStars, type StarNode } from './geometry';

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
    expect(starColor('liked')).toBe('#FFE7A4');
    expect(starColor('disliked')).toBe('#FF8D75');
    expect(starColor(null)).toBe('#FCB187');
  });
  it('filters the complete graph without mutating it or limiting to six cards', () => {
    const nodes: StarNode[] = Array.from({ length: 13 }, (_, i) => ({ request_id: `${i}`, display_name: 'Fictional', preference: i%2 ? 'disliked' : 'liked' }));
    expect(visibleStars(nodes, 'all')).toHaveLength(13);
    expect(visibleStars(nodes, 'liked')).toHaveLength(7);
    expect(visibleStars(nodes, 'disliked')).toHaveLength(6);
    expect(nodes).toHaveLength(13);
  });
  it('keeps unavailable accepted connections visible in the saved list with search and preference filters', () => {
    const nodes: StarNode[] = [
      { request_id: 'past', display_name: 'Bryan', preference: 'liked', active: false },
      { request_id: 'current', display_name: 'Steve', preference: 'liked', active: true },
      { request_id: 'private', display_name: 'Past connection', preference: null, active: false },
    ];
    expect(historicalStars(nodes, 'all', '')).toHaveLength(2);
    expect(historicalStars(nodes, 'liked', 'bry')).toEqual([nodes[0]]);
    expect(historicalStars(nodes, 'disliked', '')).toEqual([]);
  });
});
