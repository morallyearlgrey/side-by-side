import { AprilTagFamily, type Pixel } from 'apriltag';
import tag36h11 from 'apriltag/families/36h11.json';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';

const family = new AprilTagFamily(tag36h11);

export function AprilTag({ tagId, size = 220 }: { tagId: number; size?: number }) {
  const matrix = family.render(tagId);
  const cellSize = size / matrix.length;
  return <View accessibilityLabel={`AprilTag ${tagId}`} style={[styles.frame, { width: size, height: size }]}>
    <View style={styles.grid}>
      {matrix.map((row, y) => <View key={y} style={styles.row}>
        {row.map((pixel: Pixel, x) => <View key={`${y}-${x}`} style={{ width: cellSize, height: cellSize, backgroundColor: pixel === 'b' ? '#050607' : pixel === 'w' ? '#FFFFFF' : colors.muted }} />)}
      </View>)}
    </View>
  </View>;
}

export function AprilTagCard({ tagId, markerSizeTenthsMm }: { tagId: number; markerSizeTenthsMm: number }) {
  return <View style={styles.card}>
    <Text style={styles.eyebrow}>Your special ID · {tagId}</Text>
    <AprilTag tagId={tagId} />
    <Text style={styles.caption}>This is your Companion Charm identifier. Meta glasses can recognize this AprilTag during an authorized connection.</Text>
    <Text style={styles.note}>Keep it visible when sharing is on. It does not reveal your account by itself. Physical marker size: {markerSizeTenthsMm / 10} cm.</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 12, paddingTop: 4 },
  frame: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 4, borderWidth: 1, borderColor: colors.line },
  grid: { flex: 1, width: '100%', height: '100%' },
  row: { flexDirection: 'row' },
  eyebrow: { alignSelf: 'stretch', color: colors.violet, fontSize: 12, lineHeight: 18, fontWeight: '600', textTransform: 'uppercase', letterSpacing: .6 },
  caption: { alignSelf: 'stretch', color: colors.ink, fontSize: 15, lineHeight: 22 },
  note: { alignSelf: 'stretch', color: colors.muted, fontSize: 13, lineHeight: 19 },
});
