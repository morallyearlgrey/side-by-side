import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLunar } from './Lunar';
import { font } from '@/lib/theme';

type Kind = 'matches' | 'settings';
const schemes = {
  matches: { eyebrow: 'YOUR CONNECTIONS', colors: ['#FFE6DC', '#FCB187', '#FF9A54', '#AC542E'] as const, title: '#161316', description: '#34201C', glow: '#FFE9AF' },
  settings: { eyebrow: 'YOUR SPACE', colors: ['#221819', '#453027', '#A34923', '#FF6D29'] as const, title: '#FFE6DC', description: '#FFE6DC', glow: '#FFB15D' },
};

export function PageHero({ kind, title, description }: { kind: Kind; title: string; description: string }) {
  const { reducedMotion } = useLunar();
  const motion = useRef(new Animated.Value(0)).current;
  const scheme = schemes[kind];
  useEffect(() => {
    if (reducedMotion) return;
    const duration = kind === 'matches' ? 7500 : 4800;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(motion, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(motion, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [kind, motion, reducedMotion]);
  return <View style={[styles.hero, kind === 'settings' && styles.settings]}>
    <LinearGradient colors={scheme.colors} locations={[0, .35, .68, 1]} start={kind === 'matches' ? { x: 0, y: 0 } : { x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    <Animated.View pointerEvents="none" style={[styles.orb, { backgroundColor: scheme.glow, opacity: motion.interpolate({ inputRange: [0, 1], outputRange: [.22, .7] }), transform: [{ translateX: motion.interpolate({ inputRange: [0, 1], outputRange: kind === 'matches' ? [-38, 70] : [58, -48] }) }, { scale: motion.interpolate({ inputRange: [0, 1], outputRange: [.75, 1.18] }) }] }]} />
    <Text style={[styles.eyebrow, { color: scheme.title }]}>{scheme.eyebrow}</Text>
    <Text accessibilityRole="header" style={[styles.title, { color: scheme.title }]}>{title}</Text>
    <Text style={[styles.description, { maxWidth: 250, color: scheme.description }]}>{description}</Text>
  </View>;
}

const styles = StyleSheet.create({
  hero: { minHeight: 216, padding: 25, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: '#FCB18788', justifyContent: 'flex-end', gap: 9 },
  settings: { minHeight: 196, borderColor: '#FF6D2977' },
  orb: { position: 'absolute', top: -90, right: -15, width: 270, height: 290, borderRadius: 140 },
  eyebrow: { fontFamily: font, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  title: { fontFamily: font, fontSize: 44, lineHeight: 50, fontWeight: '700', letterSpacing: -1.8 },
  description: { fontFamily: font, fontSize: 15, lineHeight: 22, maxWidth: 360 },
});
