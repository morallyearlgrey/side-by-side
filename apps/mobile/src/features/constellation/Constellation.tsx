import { Ionicons } from '@expo/vector-icons';
import { Component, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Canvas } from './fiber';
import { StarScene, type SceneMotion } from './StarScene';
import { starColor, type StarNode } from './geometry';
import { colors } from '@/lib/theme';
import { s } from '@/components/ui';
import { SceneViewport } from './SceneViewport';

class SceneBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <View style={styles.fallback}><Text style={s.small}>3D is unavailable on this device. Your connections are listed below.</Text></View> : this.props.children; }
}

function Tool({ label, icon, onPress, disabled = false }: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; disabled?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={label} disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)} style={({ pressed }) => [styles.tool, pressed && { backgroundColor: colors.lavender }, disabled && { opacity: .35 }]}>
    <Ionicons name={icon} size={18} color={colors.ink} />
    {hovered && <View pointerEvents="none" style={styles.tooltip}><Text style={[s.small, { textAlign: 'center' }]}>{label}</Text></View>}
  </Pressable>;
}

export function Constellation({ nodes, active, onSelect }: { nodes: StarNode[]; active: boolean; onSelect: (node: StarNode) => void }) {
  const motion = useRef<SceneMotion>({ x: .15, y: .25, zoom: 1, dragging: false, moved: false });
  const [revision, update] = useState(0); const [paused, setPaused] = useState(false);
  const [mapSize, setMapSize] = useState(1);
  const { width } = useWindowDimensions();
  const [reduced, setReduced] = useState(true); const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduced(value); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; sub.remove(); };
  }, []);
  const origin = useRef({ x: 0, y: 0 });
  const gestures = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => { motion.current.moved = false; return false; },
    // R3F's native Canvas claims the touch on start. Capture horizontal moves
    // from it for orbit rotation, while vertical gestures can scroll the page.
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx)>4 && Math.abs(g.dx)>Math.abs(g.dy),
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx)>4 && Math.abs(g.dx)>Math.abs(g.dy),
    onPanResponderGrant: () => { origin.current = { x: motion.current.x, y: motion.current.y }; motion.current.dragging = true; motion.current.moved = true; },
    onPanResponderMove: (_, g) => { motion.current.y = origin.current.y+g.dx*.012; motion.current.x = Math.max(-1.1, Math.min(1.1, origin.current.x+g.dy*.012)); update(n => n+1); },
    onPanResponderRelease: () => { motion.current.dragging = false; },
    onPanResponderTerminate: () => { motion.current.dragging = false; },
  }), []);
  const chosen = nodes.find(node => node.request_id === selected);
  const mapHeight = Math.min(540, Math.max(320, (Math.min(width, 700) - 40) * .96)) * mapSize;
  return <View style={{ gap: 12 }}>
    <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.label}>Your constellation</Text><Text style={s.small}>{nodes.length} connections</Text></View>
    <View testID="constellation-scene" accessibilityLabel="Drag horizontally to rotate your constellation" style={[styles.scene, { height: mapHeight }]} {...gestures.panHandlers} onTouchStart={() => { motion.current.moved = false; }}>
      {active && <SceneViewport>{visible => <SceneBoundary><Canvas camera={{ position: [0, 0, 5.7], fov: 45 }} frameloop={paused || reduced || !visible ? 'demand' : 'always'} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}>
        <StarScene nodes={nodes} motion={motion} animate={!paused && !reduced && visible} revision={revision} selected={selected} onSelect={id => setSelected(id)} />
      </Canvas></SceneBoundary>}</SceneViewport>}
      {nodes.length === 0 && <View pointerEvents="none" style={styles.empty}><Text style={s.small}>Your constellation starts with a connection.</Text></View>}
    </View>
    <View style={[s.row, { justifyContent: 'center', flexWrap: 'wrap', gap: 8 }]}>
      <Tool label={paused ? 'Resume rotation' : 'Pause rotation'} icon={paused ? 'play' : 'pause'} onPress={() => setPaused(value => !value)} disabled={reduced} />
      <Tool label="Make map smaller" icon="remove" onPress={() => setMapSize(value => Math.max(.75, Math.round((value - .25) * 100) / 100))} disabled={mapSize <= .75} />
      <Text accessibilityLiveRegion="polite" style={s.small}>{Math.round(mapSize * 100)}%</Text>
      <Tool label="Make map larger" icon="add" onPress={() => setMapSize(value => Math.min(1.5, Math.round((value + .25) * 100) / 100))} disabled={mapSize >= 1.5} />
    </View>
    <Text style={[s.small, { textAlign: 'center' }]}>Drag across the stars to explore</Text>
    <View style={[s.row, { justifyContent: 'center', flexWrap: 'wrap', gap: 20 }]}>{([['liked', 'Liked'], ['disliked', 'Disliked'], [null, 'Unrated']] as const).map(([value, name]) => <View key={name} style={[s.row, { gap: 7 }]}><View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: starColor(value), shadowColor: starColor(value), shadowOpacity: .85, shadowRadius: 9 }} /><Text style={s.small}>{name}</Text></View>)}</View>
    {chosen && <Pressable accessibilityRole="button" accessibilityLabel={`View connection with ${chosen.display_name}`} onPress={() => onSelect(chosen)} style={styles.selection}><Text style={s.label}>{chosen.display_name}</Text><Ionicons name="arrow-down" size={18} color={colors.violet} /></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  scene: { width: '100%', minHeight: 240 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  empty: { position: 'absolute', bottom: 4, left: 0, right: 0, alignItems: 'center' },
  tool: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  selection: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: colors.line },
  tooltip: { position: 'absolute', bottom: 52, width: 120, padding: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.background, zIndex: 10 },
});
