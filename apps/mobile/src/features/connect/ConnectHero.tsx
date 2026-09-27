import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useScreenScroll } from '@/components/ui';
import { colors, font } from '@/lib/theme';

export function ConnectHero() {
  const drift = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const scroll = useScreenScroll();
  const { width } = useWindowDimensions();
  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;
    let lights: Animated.CompositeAnimation | undefined;
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!mounted || reduced) return;
      animation = Animated.loop(Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(drift, { toValue: 0, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      ]));
      animation.start();
      lights = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 20000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }));
      lights.start();
    });
    return () => { mounted = false; animation?.stop(); lights?.stop(); };
  }, [drift, spin]);
  return <View style={styles.hero}>
    <View style={styles.headingPanel}>
      <LinearGradient colors={['#FFE6DC', '#FFAB70', '#FF6D29', '#453027']} locations={[0, .38, .67, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Animated.View pointerEvents="none" style={[styles.headingGlow, { opacity: drift.interpolate({ inputRange: [0, 1], outputRange: [.25, .75] }), transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-55, 58] }) }] }]} />
      <Text style={styles.eyebrow}>FIND YOUR ORBIT</Text>
      <Text accessibilityRole="header" style={styles.title}>Connect</Text>
      <Text style={styles.headerDescription}>A conversation can begin right where you are.</Text>
    </View>
    <View style={[styles.orbit, { width: Math.min(width, 900), height: Math.min(430, width * .82) }]} accessible={false}>
      <Animated.View pointerEvents="none" style={[styles.lights, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
        <View style={[styles.light, { top: 4, left: '49%' }]} /><View style={[styles.light, { bottom: 22, right: 18, width: 7, height: 7 }]} /><View style={[styles.light, { top: '42%', left: 0, width: 5, height: 5 }]} />
      </Animated.View>
      <Animated.View style={[styles.imageLayer, { transform: [{ translateY: scroll ? scroll.interpolate({ inputRange: [0, 470], outputRange: [0, 110], extrapolate: 'clamp' }) : 0 }, { scale: scroll ? scroll.interpolate({ inputRange: [0, 470], outputRange: [1.1, 1.3], extrapolate: 'clamp' }) : 1.1 }, { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [5, -5] }) }] }]}>
        <Image source={require('../../../assets/cosmic/black-hole-original-cutout.png')} resizeMode="contain" style={styles.image} />
      </Animated.View>
    </View>
    <Text style={styles.description}>Your people are closer than you think. Turn on discovery to find a conversation worth having nearby.</Text>
  </View>;
}

export function EclipseDivider() {
  return <View pointerEvents="none" style={styles.divider}><View style={styles.arc} /></View>;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 4, paddingTop: 8, paddingBottom: 14 },
  headingPanel: { width: '100%', minHeight: 166, borderRadius: 28, overflow: 'hidden', padding: 24, justifyContent: 'flex-end', gap: 5, borderWidth: 1, borderColor: '#FFB78488' },
  headingGlow: { position: 'absolute', top: -70, right: 0, width: 190, height: 220, borderRadius: 110, backgroundColor: '#FFE6DC' },
  eyebrow: { color: '#453027', fontFamily: font, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  title: { color: '#161316', fontFamily: font, fontSize: 44, lineHeight: 50, letterSpacing: -1.6, fontWeight: '700' },
  headerDescription: { color: '#453027', fontFamily: font, fontSize: 14, lineHeight: 20 },
  orbit: { alignItems: 'center', justifyContent: 'center', marginHorizontal: -20, overflow: 'hidden' },
  lights: { position: 'absolute', width: '78%', height: '90%', borderRadius: 999, borderWidth: 1, borderColor: '#FF6D2944', shadowColor: '#FF6D29', shadowOpacity: .6, shadowRadius: 25 },
  light: { position: 'absolute', width: 11, height: 11, borderRadius: 8, backgroundColor: '#FFE6DC', shadowColor: '#FF6D29', shadowOpacity: 1, shadowRadius: 18, elevation: 8 },
  imageLayer: { width: '125%', height: '100%' },
  image: { width: '100%', height: '100%' },
  description: { color: colors.muted, fontFamily: font, fontSize: 16, lineHeight: 25, textAlign: 'center', maxWidth: 450, marginTop: 18 },
  divider: { height: 44, overflow: 'hidden', marginTop: 6 },
  arc: { alignSelf: 'center', width: '120%', height: 110, borderRadius: 999, borderWidth: 2, borderColor: '#FF6D29', shadowColor: '#FF6D29', shadowOpacity: .9, shadowRadius: 18, elevation: 10 },
});
