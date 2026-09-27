import { Component, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type MapView from 'react-native-maps';
import { Body, Notice } from '@/components/ui';
import { colors } from '@/lib/theme';
import { areaBounds, visualAreas, type MapArea } from './types';

class MapBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Notice>Google Maps needs a native app rebuild with its platform key.</Notice> : this.props.children; }
}

export default function GoogleLocationMap({ areas }: { areas: MapArea[] }) {
  const [maps, setMaps] = useState<typeof import('react-native-maps') | null>(null);
  const [error, setError] = useState(false);
  const map = useRef<MapView>(null);
  const configured = Platform.OS === 'ios' ? Constants.expoConfig?.extra?.googleMapsIosConfigured
    : Constants.expoConfig?.extra?.googleMapsAndroidConfigured;
  useEffect(() => {
    let cancelled = false;
    if (configured) void import('react-native-maps').then(value => { if (!cancelled) setMaps(value); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [configured]);
  if (!configured || error) return <Notice>Google Maps needs a native app rebuild with its platform key. Nearby estimates remain listed below.</Notice>;
  if (!maps || !areas.length) return <Body muted>Loading Google Maps…</Body>;
  const NativeMap = maps.default;
  const Marker = maps.Marker;
  const Circle = maps.Circle;
  const bounds = areas.flatMap(area => areaBounds(area).map(point => ({ latitude: point.lat, longitude: point.lng })));
  return <MapBoundary><NativeMap key={JSON.stringify(visualAreas(areas))} ref={map} provider={maps.PROVIDER_GOOGLE}
    style={{ width: '100%', height: 320, borderRadius: 8 }} showsUserLocation={false}
    initialRegion={{ latitude: areas[0].latitude, longitude: areas[0].longitude, latitudeDelta: .01, longitudeDelta: .01 }}
    onMapReady={() => map.current?.fitToCoordinates(bounds,
      { edgePadding: { top: 36, left: 36, right: 36, bottom: 36 }, animated: false })}>
    {areas.map(area => {
      const coordinate = { latitude: area.latitude, longitude: area.longitude };
      const color = area.own ? colors.teal : colors.accent;
      return <Circle key={area.id} center={coordinate} radius={area.uncertainty_m}
        strokeColor={color} strokeWidth={2} fillColor={area.own ? '#A2CFD024' : '#FFAB8B24'} />;
    })}
    {areas.filter(area => !area.bluetooth).map(area => <Marker key={area.id}
      coordinate={{ latitude: area.latitude, longitude: area.longitude }} title={area.name}
      description="Approximate area center" pinColor={area.own ? colors.teal : colors.accent} />)}
  </NativeMap></MapBoundary>;
}
