import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLunar } from '@/components/Lunar';
import { font } from '@/lib/theme';

export function ProfileHero({ name }: { name?: string }) {
  const { reducedMotion } = useLunar();
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 5600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(glow, { toValue: 0, duration: 5600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [glow, reducedMotion]);
  return <View style={styles.hero}>
    <LinearGradient colors={['#FFE6DC', '#FCB187', '#FF6D29', '#453027']} locations={[0, .31, .63, 1]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    <Animated.View pointerEvents="none" style={[styles.glow, { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [.28, .8] }), transform: [{ translateX: glow.interpolate({ inputRange: [0, 1], outputRange: [-30, 55] }) }] }]} />
    <Text style={styles.eyebrow}>YOUR UNIVERSE</Text>
    <Text accessibilityRole="header" style={styles.title}>Profile</Text>
    <Text style={styles.description}>{name ? `${name}, this is your story.` : 'This is your story.'} Shape the details you want others to discover.</Text>
  </View>;
}

const styles = StyleSheet.create({
  hero: { minHeight: 240, borderRadius: 28, overflow: 'hidden', padding: 26, justifyContent: 'flex-end', gap: 8, borderWidth: 1, borderColor: '#FCB18788' },
  glow: { position: 'absolute', top: -110, right: 0, width: 240, height: 350, borderRadius: 160, backgroundColor: '#FFE6DC' },
  eyebrow: { color: '#453027', fontFamily: font, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  title: { color: '#161316', fontFamily: font, fontSize: 47, lineHeight: 52, fontWeight: '700', letterSpacing: -2 },
  description: { color: '#302123', fontFamily: font, fontSize: 15, lineHeight: 23, maxWidth: 370 },
});
