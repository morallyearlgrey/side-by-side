import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type Scene = 'eclipse' | 'pair' | 'astronaut' | 'glasses';
export function SpaceCanvas({ scene, height = 420, reducedMotion = false }: { scene: Scene; height?: number; reducedMotion?: boolean }) {
  const motion = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(motion, { toValue: 1, duration: 2000, useNativeDriver: true }),
      Animated.timing(motion, { toValue: 0, duration: 2000, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [motion, reducedMotion]);
  if (scene === 'astronaut') return <View style={[styles.center, { height }]}><Animated.Image source={require('../../assets/cosmic/comet-astronaut.png')} resizeMode="contain" style={{ width: Math.min(height * .82, 300), height: height * .88, transform: [{ rotate: motion.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] }) }] }} /></View>;
  if (scene === 'glasses') return <View style={[styles.center, { height }]}><View style={styles.glasses}><View style={styles.lens} /><View style={styles.bridge} /><View style={styles.lens} /></View></View>;
  const planet = (small = false) => <Animated.View style={[styles.planetGlow, small && { width: 132, height: 132, borderRadius: 66 }, { transform: [{ translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [-5, 5] }) }] }]}><LinearGradient colors={['#FFB078', '#FF6D29', '#453027', '#161316']} start={{ x: .15, y: .1 }} end={{ x: .9, y: .95 }} style={StyleSheet.absoluteFill} /></Animated.View>;
  return <View style={[styles.center, { height, flexDirection: 'row', gap: 18 }]}>{planet(scene === 'pair')}{scene === 'pair' && planet(true)}</View>;
}
const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center', width: '100%' },
  planetGlow: { width: 260, height: 260, borderRadius: 130, overflow: 'hidden', shadowColor: '#FF6D29', shadowOpacity: .7, shadowRadius: 36, elevation: 15 },
  glasses: { flexDirection: 'row', alignItems: 'center', transform: [{ rotate: '-8deg' }] },
  lens: { width: 112, height: 102, borderRadius: 49, borderWidth: 13, borderColor: '#453027', backgroundColor: 'rgba(255,230,220,.09)' },
  bridge: { width: 24, height: 12, backgroundColor: '#453027' },
});
