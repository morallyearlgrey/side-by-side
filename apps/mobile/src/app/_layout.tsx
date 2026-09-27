import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '@/lib/query';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { BluetoothProvider } from '@/features/bluetooth/BluetoothProvider';
import { DiscoveryProvider } from '@/features/connect/DiscoveryProvider';
import { colors } from '@/lib/theme';
import { LunarProvider } from '@/components/Lunar';
export default function RootLayout() {
  return <SafeAreaProvider><LunarProvider><QueryClientProvider client={queryClient}><AuthProvider><BluetoothProvider><DiscoveryProvider><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} /></DiscoveryProvider></BluetoothProvider></AuthProvider></QueryClientProvider></LunarProvider></SafeAreaProvider>;
}
