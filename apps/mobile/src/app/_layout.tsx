import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '@/lib/query';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { BluetoothProvider } from '@/features/bluetooth/BluetoothProvider';
import { EncounterBanner } from '@/features/bluetooth/EncounterBanner';
import { colors } from '@/lib/theme';
export default function RootLayout() {
  return <SafeAreaProvider><QueryClientProvider client={queryClient}><AuthProvider><BluetoothProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} /><EncounterBanner /></BluetoothProvider></AuthProvider></QueryClientProvider></SafeAreaProvider>;
}
