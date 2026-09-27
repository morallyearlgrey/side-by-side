import { AprilTagFamily, type Pixel } from 'apriltag';
import tag36h11 from 'apriltag/families/36h11.json';

const family = new AprilTagFamily(tag36h11);

// One SVG surface keeps the marker visually intact during the Home page tilt.
export function AprilTagArtwork({ tagId, size }: { tagId: number; size: number }) {
  const matrix = family.render(tagId);
  const extent = matrix.length + 2;
  return <svg width={size} height={size} viewBox={`0 0 ${extent} ${extent}`} role="img" aria-label={`AprilTag ${tagId}`} style={{ display: 'block', margin: 'auto', borderRadius: 4, boxShadow: '0 40px 65px #0009' }}>
    <rect width={extent} height={extent} fill="#FFFFFF" />
    {matrix.map((row, y) => row.map((pixel: Pixel, x) => <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={pixel === 'b' ? '#050607' : pixel === 'w' ? '#FFFFFF' : '#BABABA'} />))}
  </svg>;
}
