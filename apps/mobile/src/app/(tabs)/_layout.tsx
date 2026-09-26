import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe } from '@/features/profile/useMe';
import { Screen } from '@/components/ui';
import { colors } from '@/lib/theme';
export default function TabsLayout() {
  const { session, loading } = useAuth(); const me = useMe();
  if (loading) return <Screen><ActivityIndicator /></Screen>;
  if (!session) return <Redirect href="/auth" />;
  if (me.data && !me.data.current_version) return <Redirect href="/onboarding" />;
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.violet, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line }, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' } }}>
    <Tabs.Screen name="index" options={{ title: 'Nearby', tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="bluetooth" options={{ title: 'Bluetooth', tabBarIcon: ({ color, size }) => <Ionicons name="bluetooth" color={color} size={size} /> }} />
    <Tabs.Screen name="matches" options={{ title: 'Matches', tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="options-outline" color={color} size={size} /> }} />
  </Tabs>;
}
