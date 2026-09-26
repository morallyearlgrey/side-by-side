import { Text, View } from 'react-native';
import { Body, Button, Label, Notice, s } from '@/components/ui';
import { canShowMeetup } from './types';
import { useMeetup } from './useMeetup';
import MeetupMap from './MeetupMap';
import GoogleMeetupMap from './GoogleMeetupMap';
import { useState } from 'react';

export function ConnectionMeetup({ requestId, userId, peerName }: { requestId: string; userId: string; peerName: string }) {
  const { state, error, busy, clock, start, stop } = useMeetup(requestId, userId);
  const [fallback, setFallback] = useState(false);
  const visible = canShowMeetup(state, clock);
  const remaining = state?.sharing_until ? Math.max(0, Math.ceil((Date.parse(state.sharing_until) - clock) / 60_000)) : 0;
  return <View style={{ gap: 12, borderTopWidth: 1, borderColor: '#E4E0ED', paddingTop: 18 }}>
    <Label>Find each other</Label>
    {!state?.sharing && state?.status !== 'unavailable' && <><Body muted>Share your precise location with {peerName} for 15 minutes. Both of you must opt in to see the map. Sharing updates while this screen is open.</Body><Text style={s.small}>Google Maps receives the viewed map area. You can separately choose the OpenStreetMap fallback.</Text><Button title="Share location for 15 minutes" icon="location-outline" loading={busy} onPress={() => void start()} /></>}
    {state?.status === 'unavailable' && <Notice>This connection is no longer available for location sharing.</Notice>}
    {state?.sharing && <>
      {visible ? <>{fallback ? <MeetupMap me={state.me} peer={state.peer} peerName={peerName} /> : <GoogleMeetupMap me={state.me} peer={state.peer} peerName={peerName} />}<Button title={fallback ? 'Use Google Maps' : 'Use OpenStreetMap fallback'} icon="map-outline" variant="quiet" onPress={() => setFallback(!fallback)} /><View style={{ gap: 4 }}><Text style={s.small}>You: about {Math.round(state.me.accuracy_m)} m accuracy. {peerName}: about {Math.round(state.peer.accuracy_m)} m accuracy.</Text><Text style={s.small}>Their location was updated {Math.max(0, Math.floor((clock - Date.parse(state.peer.observed_at)) / 1_000))} seconds ago. Meet in a public place.</Text></View></> : <Notice>{!state.peer_sharing ? `Waiting for ${peerName} to share their location.` : 'Waiting for a fresh location update from both people.'}</Notice>}
      <Text style={s.small}>{remaining > 0 ? `Your sharing ends in ${remaining} ${remaining === 1 ? 'minute' : 'minutes'}.` : 'Your location sharing has expired.'}</Text>
      <Button title="Stop sharing" icon="stop-circle-outline" variant="quiet" loading={busy} onPress={() => void stop()} />
    </>}
    {error && <Notice error>{error}</Notice>}
  </View>;
}
