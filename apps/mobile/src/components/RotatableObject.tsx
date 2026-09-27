import { useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { PanResponder, Pressable, View } from 'react-native';

export function RotatableObject({ children, label }: PropsWithChildren<{ label: string }>) {
  const [angle, setAngle] = useState(-12);
  const current = useRef(-12);
  const start = useRef(-12);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => { start.current = current.current; },
    onPanResponderMove: (_, gesture) => { current.current = start.current + gesture.dx * .55; setAngle(current.current); },
  }), []);
  return <View {...pan.panHandlers} style={{ width: '100%' }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. Drag or tap to rotate.`} onPress={() => { current.current += 35; setAngle(current.current); }}
      style={{ width: '100%', alignItems: 'center' }}>
      <View style={{ width: '100%', alignItems: 'center', transform: [{ perspective: 850 }, { rotateX: '-8deg' }, { rotateY: `${angle}deg` }] }}>{children}</View>
    </Pressable>
  </View>;
}
