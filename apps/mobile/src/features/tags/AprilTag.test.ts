import { describe, expect, it } from 'vitest';
import { AprilTagFamily } from 'apriltag';
import tag36h11 from 'apriltag/families/36h11.json';

describe('stable Companion Charm AprilTags', () => {
  it('renders valid tag36h11 markers without using account data', () => {
    const family = new AprilTagFamily(tag36h11);
    const first = family.render(0);
    const second = family.render(1);
    expect(first).toHaveLength(10);
    expect(first.every(row => row.length === 10)).toBe(true);
    expect(first).not.toEqual(second);
    expect(first[0].every(pixel => pixel === 'w')).toBe(true);
    expect(first[9].every(pixel => pixel === 'w')).toBe(true);
  });
});
