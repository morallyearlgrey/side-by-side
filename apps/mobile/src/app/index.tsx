import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe } from '@/features/profile/useMe';
import { Brand, Button, Notice, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/api';
export default function Index() {
  const { session, loading } = useAuth(); const me = useMe();
  if (loading) return <Screen><ActivityIndicator /></Screen>;
  if (!session) return <Redirect href="/auth" />;
  if (me.isPending) return <Screen><Brand /><ActivityIndicator /></Screen>;
  if (me.error) return <Screen><Brand /><Notice error>{errorMessage(me.error)}</Notice><Button title="Try again" onPress={() => void me.refetch()} /></Screen>;
  return <Redirect href={me.data?.current_version ? '/(tabs)/profile' : '/onboarding'} />;
}
