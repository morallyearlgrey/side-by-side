import { Component, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { Body, Notice } from '@/components/ui';
import type { MeetupPoint } from './types';
import type MapView from 'react-native-maps';

class MapBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Notice>Google Maps native setup required. Rebuild the app with the Google Maps native module and platform key.</Notice> : this.props.children; }
}
export default function GoogleMeetupMap({ me, peer, peerName }: { me: MeetupPoint; peer: MeetupPoint; peerName: string }) {
  const [maps, setMaps] = useState<typeof import('react-native-maps') | null>(null);
  const [error, setError] = useState(false); const map = useRef<MapView>(null);
  const configured = Platform.OS === 'ios' ? Constants.expoConfig?.extra?.googleMapsIosConfigured : Constants.expoConfig?.extra?.googleMapsAndroidConfigured;
  useEffect(() => {
    let cancelled = false;
    if (configured) void import('react-native-maps').then(value => { if (!cancelled) setMaps(value); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [configured]);
  if (!configured || error) return <Notice>Google Maps native setup required. Supply the platform Google Maps key and rebuild the native app.</Notice>;
  if (!maps) return <Body muted>Loading Google Maps.</Body>;
  const NativeMap = maps.default; const Marker = maps.Marker; const Polyline = maps.Polyline; const Circle = maps.Circle;
  const points = [me, peer].map(point => ({ latitude: point.latitude, longitude: point.longitude }));
  return <MapBoundary><NativeMap key={JSON.stringify(points)} ref={map} provider={maps.PROVIDER_GOOGLE} style={{ width: '100%', height: 320 }}
    initialRegion={{ ...points[0], latitudeDelta: .01, longitudeDelta: .01 }} showsUserLocation={false}
    onMapReady={() => map.current?.fitToCoordinates(points, { edgePadding: { top: 60, left: 60, right: 60, bottom: 60 }, animated: false })}>
    <Marker coordinate={points[0]} title="You" pinColor="#147D92" /><Marker coordinate={points[1]} title={peerName} pinColor="#D4483F" />
    <Circle center={points[0]} radius={me.accuracy_m} /><Circle center={points[1]} radius={peer.accuracy_m} />
    <Polyline coordinates={points} strokeColor="#147D92" strokeWidth={2} />
  </NativeMap><Body muted>Google Maps. The straight connector is not a route.</Body></MapBoundary>;
}
