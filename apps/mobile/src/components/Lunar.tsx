import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/lib/theme';

const LunarContext = createContext({ fontReady: false, reducedMotion: true });
export const useLunar = () => useContext(LunarContext);

export function LunarProvider({ children }: PropsWithChildren) {
  const [fontReady] = useFonts({ Michroma: require('../../assets/fonts/Michroma-Regular.ttf') });
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReducedMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { live = false; subscription.remove(); };
  }, []);
  // Font failure must never hold up authentication or access to the application.
  return <LunarContext.Provider value={{ fontReady, reducedMotion }}>{children}</LunarContext.Provider>;
}

export function LunarArtwork() {
  const { reducedMotion } = useLunar();
  const drift = useRef(new Animated.Value(0)).current;
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    drift.setValue(0);
    if (reducedMotion || !active) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 13000, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
      Animated.timing(drift, { toValue: 0, duration: 13000, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, drift, reducedMotion]);
  return <View style={styles.art} testID="lunar-artwork">
    <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { opacity: drift.interpolate({ inputRange: [0, 1], outputRange: [.84, 1] }), transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [-3, 3] }) }, { scale: 1.04 }] }]}>
      <Image source={require('../../assets/lunar/lunar-light.jpg')} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
    </Animated.View>
    <LinearGradient pointerEvents="none" colors={['#15181A00', '#15181A']} style={StyleSheet.absoluteFill} locations={[.45, 1]} />
    <Text style={styles.caption}>GOOD CONNECTIONS START CLOSE</Text>
  </View>;
}

const styles = StyleSheet.create({
  art: { height: 190, overflow: 'hidden', justifyContent: 'flex-end', marginHorizontal: -20 },
  caption: { fontSize: 10, lineHeight: 16, letterSpacing: 0, color: colors.muted, paddingHorizontal: 20, paddingBottom: 4 },
});
