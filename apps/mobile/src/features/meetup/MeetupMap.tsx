import { useState } from 'react';
import * as Linking from 'expo-linking';
import { Body, Button, Notice } from '@/components/ui';
import type { MeetupPoint } from './types';

export default function MeetupMap({ peer, peerName }: { me: MeetupPoint; peer: MeetupPoint; peerName: string }) {
  const [error, setError] = useState('');
  return <><Body>{peerName} is sharing a location accurate to about {Math.round(peer.accuracy_m)} m.</Body>
    <Button title="Open meetup map" icon="map-outline" onPress={() => {
      void Linking.openURL(`https://www.openstreetmap.org/?mlat=${peer.latitude}&mlon=${peer.longitude}#map=17/${peer.latitude}/${peer.longitude}`).catch(() => setError('Could not open the map.'));
    }} /><Body muted>Opens OpenStreetMap with their shared pin.</Body>{error && <Notice error>{error}</Notice>}</>;
}
