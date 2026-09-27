import { useEffect, useRef, useState } from 'react';
import { Body, Notice } from '@/components/ui';
import { config } from '@/lib/config';
import { colors } from '@/lib/theme';
import { loadGoogleMaps, type GoogleMaps } from '@/features/meetup/googleMapsLoader.web';
import { areaBounds, visualAreas, type MapArea, type MapVisualArea } from './types';

type MapInstance = InstanceType<GoogleMaps['Map']>;
type MapBounds = InstanceType<GoogleMaps['LatLngBounds']>;

export default function GoogleLocationMap({ areas }: { areas: MapArea[] }) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<{ maps: GoogleMaps; map: MapInstance } | null>(null);
  const currentBounds = useRef<MapBounds | null>(null);
  const initialArea = useRef(areas[0]);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const signature = JSON.stringify(visualAreas(areas));

  // Keep a single Google Map per mounted view. Polling and moving between
  // coarse cells only update overlays, avoiding extra billed map loads.
  useEffect(() => {
    if (!config.googleMapsWebKey) return;
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    let owned: { maps: GoogleMaps; map: MapInstance } | null = null;
    const failed = () => { if (!cancelled) setError('Google Maps authorization failed. Check the key and allowed website origins.'); };
    window.addEventListener('sidebyside-maps-auth-error', failed);
    void loadGoogleMaps(config.googleMapsWebKey).then(maps => {
      const container = element.current;
      if (cancelled || !container) return;
      const map = new maps.Map(container, {
        center: { lat: initialArea.current.latitude, lng: initialArea.current.longitude }, zoom: 14, maxZoom: 16,
        streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
        gestureHandling: 'cooperative',
      });
      owned = { maps, map };
      instance.current = owned;
      resize = new ResizeObserver(entries => {
        if (currentBounds.current && entries.some(entry => entry.contentRect.width > 0 && entry.contentRect.height > 0)) {
          map.fitBounds(currentBounds.current, 36);
        }
      });
      resize.observe(container);
      setReady(true);
    }).catch(() => { if (!cancelled) setError('Google Maps could not load. Check your connection and try refreshing the map.'); });
    return () => {
      cancelled = true;
      resize?.disconnect();
      window.removeEventListener('sidebyside-maps-auth-error', failed);
      if (owned) owned.maps.event.clearInstanceListeners(owned.map);
      if (instance.current === owned) instance.current = null;
      // React owns removal of the element. Clearing its children here can
      // erase a newer map during a development effect replay or hot reload.
    };
  }, []);

  useEffect(() => {
    if (!ready || !instance.current) return;
    const { maps, map } = instance.current;
    const estimates = JSON.parse(signature) as MapVisualArea[];
    const bounds = new maps.LatLngBounds();
    const overlays = estimates.flatMap(area => {
      const center = { lat: area.latitude, lng: area.longitude };
      const color = area.own ? colors.teal : colors.accent;
      areaBounds(area).forEach(point => bounds.extend(point));
      const circle = new maps.Circle({ map, center, radius: area.uncertainty_m,
        strokeColor: color, strokeWeight: area.bluetooth ? 1 : 2,
        strokeOpacity: .8, fillColor: color, fillOpacity: area.bluetooth ? .08 : .14 });
      // Radio detections have no bearing. Shade the observer's area without
      // placing a peer marker at an invented geographic position.
      return area.bluetooth ? [circle] : [circle, new maps.Marker({ map, position: center,
        title: area.name, label: area.own ? 'You' : undefined,
        icon: { path: maps.SymbolPath.CIRCLE, scale: area.own ? 10 : 7,
          fillColor: color, fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2 } })];
    });
    currentBounds.current = bounds;
    if (estimates.length) map.fitBounds(bounds, 36);
    return () => { overlays.forEach(overlay => { overlay.setMap(null); maps.event.clearInstanceListeners(overlay); }); };
  }, [ready, signature]);

  if (!config.googleMapsWebKey) return <Notice>Google Maps is not configured for this website build.</Notice>;
  return <>{!error && <div ref={element} role="region" aria-label="Google Maps showing approximate nearby areas"
    style={{ width: '100%', height: 320, minWidth: 0, borderRadius: 8, overflow: 'hidden', background: colors.pale }} />}
    {!error && !ready && <Body muted>Loading Google Maps…</Body>}
    {error && <Notice error>{error}</Notice>}</>;
}
