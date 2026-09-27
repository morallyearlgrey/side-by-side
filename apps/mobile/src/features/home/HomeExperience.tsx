import { useRef } from 'react';
import { router } from 'expo-router';
import { Animated, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Card } from '@/components/ui';
import { SketchfabPreview } from '@/components/SketchfabPreview';
import { RotatableObject } from '@/components/RotatableObject';
import { AprilTag } from '@/features/tags/AprilTag';
import { colors } from '@/lib/theme';
import { useLunar } from '@/components/Lunar';
import { ScrollReveal } from '@/components/ScrollReveal';
import { communityCountLabel, useCommunityCount } from './useCommunityCount';

const title = { color: colors.ink, fontSize: 38, lineHeight: 44, letterSpacing: -2.2, fontWeight: '400' as const };

export function HomeExperience() {
  const community = useCommunityCount();
  const { reducedMotion } = useLunar();
  const scroll = useRef(new Animated.Value(0)).current;
  const shift = (inputRange: number[], outputRange: number[]) => reducedMotion ? 0 : scroll.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: '#161316' }}>
    <LinearGradient pointerEvents="none" colors={['#453027', '#24181B', '#161316']} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />
    <Animated.ScrollView onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scroll } } }], { useNativeDriver: true })} scrollEventThrottle={32} contentContainerStyle={{ width: '100%', maxWidth: 700, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 125, gap: 28 }}>
      <View style={{ alignItems: 'center', paddingTop: 26, gap: 10 }}>
        <Text style={{ color: '#FCB187', letterSpacing: 2.8, fontSize: 10 }}>A UNIVERSE OF REAL CONNECTION</Text>
        <Text adjustsFontSizeToFit minimumFontScale={.76} numberOfLines={1} style={[title, { fontSize: 48, lineHeight: 62, textAlign: 'center', color: '#FCB187', width: '100%' }]}>sidebyside</Text>
        <Text style={[title, { textAlign: 'center', fontSize: 29, lineHeight: 35 }]}>Your people. Closer than you think.</Text>
        <View style={{ borderWidth: 1, borderColor: '#FCB18766', borderRadius: 999, backgroundColor: '#45302788', paddingHorizontal: 18, paddingVertical: 10 }}>
          <Text accessibilityLiveRegion="polite" style={{ color: '#FFE6DC', fontSize: 14, textAlign: 'center' }}>{communityCountLabel(community.data?.users, community.isError)}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>Meet the people around you through the things that make you, you.</Text>
      </View>
      <Animated.View style={{ transform: [{ translateY: shift([0, 520], [0, 150]) }, { scale: reducedMotion ? 1.12 : scroll.interpolate({ inputRange: [0, 520], outputRange: [1.12, 1.7], extrapolate: 'clamp' }) }] }}><SketchfabPreview model="mars" height={340} /></Animated.View>
      <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><View style={{ gap: 12, paddingVertical: 38 }}><Text style={[title, { textAlign: 'center' }]}>Less scrolling. More showing up.</Text><Body>SidebySide helps you discover people nearby with shared interests, then gives you a reason to put the phone away and meet naturally.</Body></View></ScrollReveal>
      <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><View style={{ gap: 16 }}><Text style={[title, { textAlign: 'center' }]}>Start somewhere real.</Text><Text style={{ color: colors.muted, textAlign: 'center' }}>Two paths to a real conversation.</Text></View></ScrollReveal>
      <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><View style={{ flexDirection: 'row', gap: 10 }}>
        <Animated.View style={{ flex: 1, transform: [{ translateY: shift([360, 950], [35, -28]) }, { rotate: reducedMotion ? '0deg' : scroll.interpolate({ inputRange: [360, 950], outputRange: ['-7deg', '7deg'], extrapolate: 'clamp' }) }] }}><SketchfabPreview model="planet" height={215} /></Animated.View>
        <Animated.View style={{ flex: 1, transform: [{ translateY: shift([360, 950], [-30, 32]) }, { rotate: reducedMotion ? '0deg' : scroll.interpolate({ inputRange: [360, 950], outputRange: ['8deg', '-8deg'], extrapolate: 'clamp' }) }] }}><SketchfabPreview model="venus" height={215} /></Animated.View>
      </View></ScrollReveal>
      <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><View style={{ gap: 12, marginTop: 18 }}><Button title="Find connections" onPress={() => router.push('/(tabs)/connect')} /><Button title="Edit profile" variant="secondary" onPress={() => router.push('/(tabs)/profile')} /></View></ScrollReveal>
      <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><Card title="Built on UCF’s Newton supercomputer"><Body>We calibrated our matching policy and evaluated a 4-billion-parameter Qwen3 reranker on Newton. Qwen3 checks whether two approved profiles support the conversation both people want; DeBERTa checks firsthand claims, and MiniLM compares conversation style. In a controlled synthetic evaluation, the system recommended 19 of 21 supported pairs and deferred all 24 unknown cases. These are development results, not a real-world success rate. A suggestion reaches both people, and a connection appears in Matches only after both accept.</Body></Card></ScrollReveal>
      <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><Animated.View style={{ transform: [{ translateY: shift([1200, 1900], [30, -25]) }] }}><RotatableObject label="Rotate VR glasses illustration"><SketchfabPreview model="glasses" height={225} /></RotatableObject></Animated.View></ScrollReveal>
      <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><View style={{ alignItems: 'center', gap: 18 }}><Text style={[title, { textAlign: 'center', fontSize: 31 }]}>Meet Comet in the real world.</Text><RotatableObject label="Rotate Comet Charm AprilTag"><AprilTag tagId={3} size={160} /></RotatableObject><Body>The glasses model is a visual reference, not Meta hardware. Your own Comet Charm ID appears in Connect; supported Meta glasses can recognize it during an authorized encounter.</Body></View></ScrollReveal>
      <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><Card title="No glasses or Comet Charm?"><Body>Use location discovery here or on the website. The mobile app also supports Bluetooth discovery when both people enable it.</Body></Card></ScrollReveal>
      <ScrollReveal scroll={scroll} reducedMotion={reducedMotion}><Card title="Visual credits" defaultExpanded={false}><Body>Mars model reference by v7x; Planet by dubson, Venus by butcher.cnd, VR glasses concept by taigo, and Connect black hole by rubykamen on Sketchfab. The latter four are CC BY. The black hole image has its background removed and color warmed.</Body></Card></ScrollReveal>
    </Animated.ScrollView>
  </SafeAreaView>;
}
