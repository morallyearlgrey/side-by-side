import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useLunar } from './Lunar';
export function TabMaterial() {
  const { reducedMotion } = useLunar();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 4500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 4500, useNativeDriver: true }),
    ])); animation.start(); return () => animation.stop();
  }, [pulse, reducedMotion]);
  return <View pointerEvents="none" style={styles.shell}><BlurView intensity={42} tint="dark" style={StyleSheet.absoluteFill} /><Animated.View style={[styles.glow, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [.35, 1] }) }]} /></View>;
}
const styles = StyleSheet.create({ shell: { ...StyleSheet.absoluteFillObject, borderRadius: 27, overflow: 'hidden', borderWidth: 1, borderColor: '#FCB18777', backgroundColor: '#45302788' }, glow: { position: 'absolute', left: 25, right: 25, top: 0, height: 2, backgroundColor: '#FF6D29', shadowColor: '#FF6D29', shadowRadius: 10, shadowOpacity: 1 } });
