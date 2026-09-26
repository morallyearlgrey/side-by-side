import { router } from 'expo-router';
import { Body, Brand, Button, Card, Heading, Screen } from '@/components/ui';
import { DiscoveryControls } from '@/features/connect/DiscoveryControls';
export default function Permissions() {
  return <Screen><Brand /><Heading eyebrow="Connection on your terms" title={"Make room\nfor a hello."} subtitle="Choose how you’d like to find people. You can change either option anytime." />
    <Card><DiscoveryControls /></Card>
    <Button title="Take me to SidebySide" onPress={() => router.replace('/(tabs)')} icon="arrow-forward" /><Body muted>These choices are optional. Your account works with discovery turned off.</Body>
  </Screen>;
}
