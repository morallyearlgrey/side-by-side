import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe } from '@/features/profile/useMe';
import { Screen } from '@/components/ui';
import { colors } from '@/lib/theme';
function TabMaterial() {
  const [opaque, setOpaque] = useState(Platform.OS === 'android');
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let live = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (live) setOpaque(value); });
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOpaque);
    return () => { live = false; sub.remove(); };
  }, []);
  return opaque ? <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} /> : <BlurView intensity={35} tint="dark" style={[StyleSheet.absoluteFill, { backgroundColor: colors.tabMaterial }]} />;
}
export default function TabsLayout() {
  const { session, loading } = useAuth(); const me = useMe();
  if (loading) return <Screen><ActivityIndicator /></Screen>;
  if (!session) return <Redirect href="/auth" />;
  if (me.data && !me.data.current_version) return <Redirect href="/onboarding" />;
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.violet, tabBarInactiveTintColor: colors.muted, tabBarBackground: () => <TabMaterial />, tabBarStyle: { backgroundColor: 'transparent', borderTopColor: colors.line }, tabBarItemStyle: { minHeight: 48 }, tabBarLabelStyle: { fontSize: 11, fontWeight: '500', letterSpacing: 0 } }}>
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="options-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="matches" options={{ title: 'Matches', tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="index" options={{ title: 'Connect', tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="bluetooth" options={{ href: null }} />
  </Tabs>;
}
