import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Body, Brand, Card, EmptyState, Heading, Notice, Screen, Toggle, s } from '@/components/ui';
import { useBluetooth } from '@/features/bluetooth/BluetoothProvider';
import { PersonCard } from '@/features/nearby/PersonCard';
import { colors } from '@/lib/theme';
export default function Bluetooth() {
  const ble = useBluetooth();
  return <Screen><Brand /><Heading eyebrow="Be here. Be open." title={"Cross paths.\nFind a connection."} subtitle="Discover other SidebySide phones in Bluetooth range, without exchanging personal details." />
    <LinearGradient colors={['#E4DFF7', '#EEEAF8', '#E0DAF4']} style={{ height: 250, borderRadius: 30, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
      {[240, 174, 106].map(size => <View key={size} style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: '#FFFFFFD0' }} />)}
      <View style={{ height: 70, width: 70, borderRadius: 25, backgroundColor: ble.state.live ? colors.violet : '#FFFFFF', justifyContent: 'center', alignItems: 'center' }}><Ionicons name="bluetooth" size={31} color={ble.state.live ? 'white' : colors.violet} /></View>
      <Text style={[s.eyebrow, { position: 'absolute', bottom: 25 }]}>{ble.state.live ? 'OPEN TO A HELLO' : ble.state.status === 'starting' ? 'STARTING DISCOVERY' : 'YOUR SPACE. YOUR SWITCH.'}</Text>
    </LinearGradient>
    <Card><Toggle title={ble.state.live ? 'You’re Live' : 'Go Live'} description="Keep SidebySide open. Live turns off when the app goes into the background." value={ble.state.live || ble.state.status === 'starting'} disabled={ble.busy} onValueChange={value => void (value ? ble.start() : ble.stop())} />{!!ble.error && <Notice error>{ble.error}</Notice>}{!ble.state.available && <Notice>Phone discovery is available in the native iPhone build. This preview can show the screens, but cannot use the Bluetooth radio.</Notice>}</Card>
    <Body muted>Bluetooth indicates nearby signals, not an exact distance. Additional profile details are shared only when you both accept.</Body>
    {ble.encounters.map((encounter, index) => encounter.candidate_id && encounter.preview ? <PersonCard key={encounter.candidate_id} userId={encounter.candidate_id} preview={encounter.preview} rank={index + 1} mode="ble" canInvite={encounter.status === 'scored'} /> : null)}
    {ble.encounters.length === 0 && <EmptyState icon="radio-outline" title={ble.state.live ? 'Leave a little space for serendipity.' : 'A hello starts here.'} message={ble.state.live ? 'When another eligible SidebySide phone is nearby, their approved preview can appear here.' : 'Turn Live on when you’re ready to discover people around you.'} />}
  </Screen>;
}
