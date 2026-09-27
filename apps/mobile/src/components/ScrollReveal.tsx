import { useState, type PropsWithChildren } from 'react';
import { Animated, useWindowDimensions } from 'react-native';

export function ScrollReveal({ scroll, reducedMotion, children }: PropsWithChildren<{ scroll: Animated.Value; reducedMotion: boolean }>) {
  const { height } = useWindowDimensions();
  const [top, setTop] = useState<number | null>(null);
  const start = (top ?? 0) - height * .88;
  const end = (top ?? 0) - height * .55;
  return <Animated.View onLayout={event => setTop(event.nativeEvent.layout.y)} style={[{ width: '100%' }, !reducedMotion && top !== null && {
    opacity: scroll.interpolate({ inputRange: [start, end], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: scroll.interpolate({ inputRange: [start, end], outputRange: [20, 0], extrapolate: 'clamp' }) }],
  }]}>{children}</Animated.View>;
}
