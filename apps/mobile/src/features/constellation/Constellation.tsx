import { Ionicons } from '@expo/vector-icons';
import { Component, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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

const clampZoom = (zoom: number) => Math.max(.7, Math.min(2.2, zoom));
const distance = (touches: readonly { pageX: number; pageY: number }[]) => touches.length < 2 ? 0
  : Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);

export function Constellation({ nodes, active, onSelect }: { nodes: StarNode[]; active: boolean; onSelect: (node: StarNode) => void }) {
  const motion = useRef<SceneMotion>({ x: .15, y: .25, zoom: 1, dragging: false, moved: false });
  const [revision, update] = useState(0);
  const { width } = useWindowDimensions();
  const [reduced, setReduced] = useState(true); const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduced(value); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; sub.remove(); };
  }, []);
  const origin = useRef({ x: 0, y: 0 });
  const pinch = useRef({ distance: 0, zoom: 1 });
  const gestures = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => { motion.current.moved = false; return false; },
    // R3F's native Canvas claims the touch on start. Capture horizontal moves
    // from it for orbit rotation, while two fingers capture a pinch for zoom.
    onMoveShouldSetPanResponderCapture: (event, g) => (event.nativeEvent.touches?.length ?? 0) >= 2 || Math.abs(g.dx)>4 && Math.abs(g.dx)>Math.abs(g.dy),
    onMoveShouldSetPanResponder: (event, g) => (event.nativeEvent.touches?.length ?? 0) >= 2 || Math.abs(g.dx)>4 && Math.abs(g.dx)>Math.abs(g.dy),
    onPanResponderGrant: event => {
      origin.current = { x: motion.current.x, y: motion.current.y };
      pinch.current = { distance: distance(event.nativeEvent.touches ?? []), zoom: motion.current.zoom };
      motion.current.dragging = true; motion.current.moved = true;
    },
    onPanResponderMove: (event, g) => {
      const currentDistance = distance(event.nativeEvent.touches ?? []);
      if (currentDistance > 0) {
        if (!pinch.current.distance) pinch.current = { distance: currentDistance, zoom: motion.current.zoom };
        motion.current.zoom = clampZoom(pinch.current.zoom * currentDistance / pinch.current.distance);
      } else {
        pinch.current.distance = 0;
        motion.current.y = origin.current.y+g.dx*.012;
        motion.current.x = Math.max(-1.1, Math.min(1.1, origin.current.x+g.dy*.012));
      }
      update(n => n+1);
    },
    onPanResponderRelease: () => { motion.current.dragging = false; pinch.current.distance = 0; },
    onPanResponderTerminate: () => { motion.current.dragging = false; pinch.current.distance = 0; },
  }), []);
  const wheelHandlers = Platform.OS === 'web' ? { onWheel: (event: { deltaY?: number; nativeEvent?: { deltaY?: number }; preventDefault?: () => void }) => {
    event.preventDefault?.();
    const delta = event.deltaY ?? event.nativeEvent?.deltaY ?? 0;
    motion.current.zoom = clampZoom(motion.current.zoom * Math.exp(-delta * .0012));
    update(n => n+1);
  } } : {};
  const chosen = nodes.find(node => node.request_id === selected);
  const mapHeight = Math.min(540, Math.max(320, (Math.min(width, 700) - 40) * .96));
  return <View style={{ gap: 12 }}>
    <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.label}>Your constellation</Text><Text style={s.small}>{nodes.length} connections</Text></View>
    <View testID="constellation-scene" accessibilityLabel="Drag to rotate; pinch or scroll to zoom your constellation" style={[styles.scene, { height: mapHeight }]} {...gestures.panHandlers} {...wheelHandlers} onTouchStart={() => { motion.current.moved = false; }}>
      {active && <SceneViewport>{visible => <SceneBoundary><Canvas camera={{ position: [0, 0, 5.7], fov: 45 }} frameloop={reduced || !visible ? 'demand' : 'always'} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}>
        <StarScene nodes={nodes} motion={motion} animate={!reduced && visible} revision={revision} selected={selected} onSelect={id => setSelected(id)} />
      </Canvas></SceneBoundary>}</SceneViewport>}
      {nodes.length === 0 && <View pointerEvents="none" style={styles.empty}><Text style={s.small}>Your constellation starts with a connection.</Text></View>}
    </View>
    <Text accessibilityLiveRegion="polite" style={[s.small, { textAlign: 'center' }]}>Drag to rotate · pinch or scroll to zoom · {Math.round(motion.current.zoom * 100)}%</Text>
    <View style={[s.row, { justifyContent: 'center', flexWrap: 'wrap', gap: 20 }]}>{([['liked', 'Liked'], ['disliked', 'Disliked'], [null, 'Unrated']] as const).map(([value, name]) => <View key={name} style={[s.row, { gap: 7 }]}><View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: starColor(value), shadowColor: starColor(value), shadowOpacity: .85, shadowRadius: 9 }} /><Text style={s.small}>{name}</Text></View>)}</View>
    {chosen && <Pressable accessibilityRole="button" accessibilityLabel={`View connection with ${chosen.display_name}`} onPress={() => onSelect(chosen)} style={styles.selection}><Text style={s.label}>{chosen.display_name}</Text><Ionicons name="arrow-down" size={18} color={colors.violet} /></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  scene: { width: '100%', minHeight: 240 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  empty: { position: 'absolute', bottom: 4, left: 0, right: 0, alignItems: 'center' },
  selection: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: colors.line },
});
