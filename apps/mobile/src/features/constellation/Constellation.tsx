import { Ionicons } from '@expo/vector-icons';
import { Component, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
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
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx)>6 && Math.abs(g.dx)>Math.abs(g.dy),
    onPanResponderGrant: () => { origin.current = { x: motion.current.x, y: motion.current.y }; motion.current.dragging = true; motion.current.moved = true; },
    onPanResponderMove: (_, g) => { motion.current.y = origin.current.y+g.dx*.009; motion.current.x = Math.max(-1.1, Math.min(1.1, origin.current.x+g.dy*.009)); update(n => n+1); },
    onPanResponderRelease: () => { motion.current.dragging = false; },
    onPanResponderTerminate: () => { motion.current.dragging = false; },
  }), []);
  const rotate = (by: number) => { motion.current.y += by; update(n => n+1); };
  const zoom = (by: number) => { motion.current.zoom = Math.max(.75, Math.min(1.12, motion.current.zoom+by)); update(n => n+1); };
  const chosen = nodes.find(node => node.request_id === selected);
  return <View style={{ gap: 12 }}>
    <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.label}>Your constellation</Text><Text style={s.small}>{nodes.length} connections</Text></View>
    <View testID="constellation-scene" style={styles.scene} {...gestures.panHandlers} onTouchStart={() => { motion.current.moved = false; }}>
      {active && <SceneViewport>{visible => <SceneBoundary><Canvas camera={{ position: [0, 0, 5.7], fov: 45 }} frameloop={paused || reduced || !visible ? 'demand' : 'always'} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}>
        <StarScene nodes={nodes} motion={motion} animate={!paused && !reduced && visible} revision={revision} selected={selected} onSelect={id => setSelected(id)} />
      </Canvas></SceneBoundary>}</SceneViewport>}
      {nodes.length === 0 && <View pointerEvents="none" style={styles.empty}><Text style={s.small}>Your constellation starts with a connection.</Text></View>}
    </View>
    <View style={[s.row, { justifyContent: 'center', flexWrap: 'wrap', gap: 8 }]}>
      <Tool label="Rotate left" icon="arrow-back" onPress={() => rotate(-.3)} />
      <Tool label={paused ? 'Resume rotation' : 'Pause rotation'} icon={paused ? 'play' : 'pause'} onPress={() => setPaused(value => !value)} disabled={reduced} />
      <Tool label="Rotate right" icon="arrow-forward" onPress={() => rotate(.3)} />
      <Tool label="Zoom out" icon="remove" onPress={() => zoom(-.1)} disabled={motion.current.zoom <= .75} />
      <Tool label="Zoom in" icon="add" onPress={() => zoom(.1)} disabled={motion.current.zoom >= 1.12} />
    </View>
    <View style={[s.row, { justifyContent: 'center', flexWrap: 'wrap', gap: 20 }]}>{([['liked', 'Liked'], ['disliked', 'Disliked'], [null, 'Unrated']] as const).map(([value, name]) => <View key={name} style={[s.row, { gap: 7 }]}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: starColor(value) }} /><Text style={s.small}>{name}</Text></View>)}</View>
    {chosen && <Pressable accessibilityRole="button" accessibilityLabel={`View connection with ${chosen.display_name}`} onPress={() => onSelect(chosen)} style={styles.selection}><Text style={s.label}>{chosen.display_name}</Text><Ionicons name="arrow-down" size={18} color={colors.violet} /></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  scene: { width: '100%', aspectRatio: 1.22, maxHeight: 340, minHeight: 250 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  empty: { position: 'absolute', bottom: 4, left: 0, right: 0, alignItems: 'center' },
  tool: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  selection: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: colors.line },
  tooltip: { position: 'absolute', bottom: 52, width: 120, padding: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.background, zIndex: 10 },
});
