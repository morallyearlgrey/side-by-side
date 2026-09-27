import { useEffect, useRef, useState } from 'react';
import { Body, Notice } from '@/components/ui';
import { config } from '@/lib/config';
import type { MeetupPoint } from './types';
import { loadGoogleMaps } from './googleMapsLoader.web';

export default function GoogleMeetupMap({ me, peer, peerName }: { me: MeetupPoint; peer: MeetupPoint; peerName: string }) {
  const element = useRef<HTMLDivElement>(null); const [error, setError] = useState('');
  useEffect(() => {
    if (!config.googleMapsWebKey) return;
    let cancelled = false; let clean: (() => void) | undefined;
    const container = element.current;
    const failed = () => { clean?.(); setError('Google Maps authorization failed. Check the web key and origin configuration.'); };
    window.addEventListener('sidebyside-maps-auth-error', failed);
    void loadGoogleMaps(config.googleMapsWebKey).then(maps => {
      if (cancelled || !container) return;
      const points = [me, peer].map(point => ({ lat: point.latitude, lng: point.longitude }));
      const map = new maps.Map(container, { center: points[0], zoom: 16, maxZoom: 18, streetViewControl: false, mapTypeControl: false, fullscreenControl: false });
      const bounds = new maps.LatLngBounds(); points.forEach(point => bounds.extend(point)); map.fitBounds(bounds, 60);
      const overlays = points.flatMap((point, index) => [
        new maps.Marker({ map, position: point, title: index ? peerName : 'You', label: index ? '2' : '1',
          icon: { path: maps.SymbolPath.CIRCLE, scale: 12, fillColor: index ? '#D4483F' : '#147D92', fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2 } }),
        new maps.Circle({ map, center: point, radius: (index ? peer : me).accuracy_m, strokeWeight: 1, fillOpacity: .08 }),
      ]);
      overlays.push(new maps.Polyline({ map, path: points, geodesic: false, strokeColor: '#147D92', strokeWeight: 2 }));
      clean = () => { overlays.forEach(overlay => { overlay.setMap(null); maps.event.clearInstanceListeners(overlay); }); maps.event.clearInstanceListeners(map); container.replaceChildren(); };
    }).catch(cause => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; clean?.(); window.removeEventListener('sidebyside-maps-auth-error', failed); };
  }, [me, peer, peerName]);
  if (!config.googleMapsWebKey) return <Notice>Google Maps web setup required. A restricted Maps JavaScript API key must be supplied for this build.</Notice>;
  return <>{!error && <div ref={element} role="region" aria-label={`Google Maps: you and ${peerName}`} style={{ width: '100%', height: 320, minWidth: 0, borderRadius: 8, overflow: 'hidden' }} />}
    {!!error && <Notice error>{error}</Notice>}<Body muted>Google Maps. Node 1 is you; node 2 is your connection. The straight connector is not a route.</Body></>;
}
