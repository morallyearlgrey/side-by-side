import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe } from '@/features/profile/useMe';
import { Screen } from '@/components/ui';
import { colors } from '@/lib/theme';
import { TabMaterial } from '@/components/TabMaterial';
export default function TabsLayout() {
  const { session, loading } = useAuth(); const me = useMe();
  const { width } = useWindowDimensions();
  const centeredNavigation = Platform.OS === 'web' && width > 672;
  const navigationWidth = Math.min(640, width - 32);
  if (loading) return <Screen><ActivityIndicator /></Screen>;
  if (!session) return <Redirect href="/auth" />;
  if (me.data && !me.data.current_version) return <Redirect href="/onboarding" />;
  return <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: false, tabBarActiveTintColor: colors.violet, tabBarInactiveTintColor: '#C6B7B0', tabBarBackground: () => <TabMaterial />, tabBarStyle: { position: 'absolute', bottom: Platform.OS === 'web' ? 20 : 16, left: centeredNavigation ? (width - navigationWidth) / 2 : 16, right: centeredNavigation ? undefined : 16, width: centeredNavigation ? navigationWidth : undefined, height: 68, maxWidth: 640, borderRadius: 28, borderTopWidth: 0, backgroundColor: 'transparent', elevation: 0 }, tabBarItemStyle: { minHeight: 60, paddingTop: 9 } }}>
    <Tabs.Screen name="home" options={{ title: 'Home', tabBarAccessibilityLabel: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="connect" options={{ title: 'Connect', tabBarAccessibilityLabel: 'Connect', tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="matches" options={{ title: 'Matches', tabBarAccessibilityLabel: 'Matches', tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarAccessibilityLabel: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarAccessibilityLabel: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="bluetooth" options={{ href: null }} />
  </Tabs>;
}
