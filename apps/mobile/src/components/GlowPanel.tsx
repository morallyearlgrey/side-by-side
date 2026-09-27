import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
export function GlowPanel({ children }: PropsWithChildren) {
  return <View style={styles.outer}><BlurView intensity={45} tint="dark" style={styles.glass}>{children}</BlurView></View>;
}
const styles = StyleSheet.create({
  outer: { borderRadius: 28, borderWidth: 1, borderColor: '#FCB18788', overflow: 'hidden', backgroundColor: '#45302755', shadowColor: '#FF6D29', shadowOpacity: .25, shadowRadius: 28, elevation: 8 },
  glass: { padding: 24, gap: 16, backgroundColor: '#16131655' },
});
