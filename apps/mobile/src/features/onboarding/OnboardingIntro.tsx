import { useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { SpaceCanvas } from '@/components/SpaceCanvas';
import { SketchfabPreview } from '@/components/SketchfabPreview';
import { Button } from '@/components/ui';
import { useLunar } from '@/components/Lunar';
import { ScrollReveal } from '@/components/ScrollReveal';

export function OnboardingIntro({ onStart }: { onStart: () => void }) {
  const { reducedMotion } = useLunar();
  const scroll = useRef(new Animated.Value(0)).current;
  return <Animated.ScrollView style={{ flex: 1, backgroundColor: '#161316' }} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scroll } } }], { useNativeDriver: true })} scrollEventThrottle={16} contentContainerStyle={{ alignItems: 'center', padding: 24, paddingBottom: 70 }}>
    <View style={{ alignItems: 'center', gap: 16, minHeight: 600, justifyContent: 'center' }}><Text style={{ color: '#FCB187', letterSpacing: 3, fontSize: 11 }}>WELCOME TO YOUR ORBIT</Text><Text style={{ color: '#FFE6DC', fontSize: 46, lineHeight: 52, textAlign: 'center', letterSpacing: -2 }}>Every connection starts somewhere.</Text><Text style={{ color: '#BABABA', fontSize: 17, textAlign: 'center' }}>Let’s discover the things that make you, you.</Text><Animated.View style={{ width: '100%', transform: [{ translateY: reducedMotion ? 0 : scroll.interpolate({ inputRange: [0, 500], outputRange: [0, 105], extrapolate: 'clamp' }) }] }}><SketchfabPreview model="mars" height={270} /></Animated.View><Text style={{ color: '#FCB187', letterSpacing: 2 }}>SCROLL TO MEET COMET ↓</Text></View>
    <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><View style={{ alignItems: 'center', gap: 18, minHeight: 650, justifyContent: 'center' }}><SpaceCanvas scene="astronaut" height={300} reducedMotion={reducedMotion} /><Text style={{ color: '#FFE6DC', fontSize: 44, textAlign: 'center' }}>Hi, I’m Comet.</Text><Text style={{ color: '#BABABA', fontSize: 16, lineHeight: 24, textAlign: 'center' }}>I’ll help create a profile from your words. You’ll review every detail before it is used for matching.</Text><View style={{ width: '100%', maxWidth: 340 }}><Button title="Begin my journey" onPress={onStart} /></View></View></ScrollReveal>
  </Animated.ScrollView>;
}
