import { useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/ui';
import type { Map, LayerGroup } from 'leaflet';
import type { MeetupPoint } from './types';
import 'leaflet/dist/leaflet.css';

export default function MeetupMap({ me, peer, peerName }: { me: MeetupPoint; peer: MeetupPoint; peerName: string }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null); const pins = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    void import('leaflet').then(L => {
      if (cancelled || !element.current) return;
      const instance = L.map(element.current, { scrollWheelZoom: false, maxZoom: 19 });
      map.current = instance;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).on('tileerror', () => setError('Map tiles could not load. Your shared pins are still shown.')).addTo(instance);
      pins.current = L.layerGroup().addTo(instance);
      resize = new ResizeObserver(() => instance.invalidateSize());
      resize.observe(element.current);
      setReady(true);
    }).catch(() => { if (!cancelled) setError('The map could not load. Try reopening this connection.'); });
    return () => { cancelled = true; resize?.disconnect(); map.current?.remove(); map.current = null; pins.current = null; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void import('leaflet').then(L => {
      if (cancelled || !map.current || !pins.current) return;
      pins.current.clearLayers();
      for (const [point, name, color, direction] of [[me, 'You', '#147D92', 'left'], [peer, peerName, '#D4483F', 'right']] as const) {
        const coordinate = L.latLng(point.latitude, point.longitude);
        L.circle(coordinate, { radius: point.accuracy_m, color, weight: 1, fillOpacity: 0.08 }).addTo(pins.current);
        const label = document.createElement('span');
        label.textContent = name;
        label.style.cssText = 'display:block;width:max-content;max-width:90px;white-space:normal;overflow-wrap:anywhere;';
        L.circleMarker(coordinate, { radius: name === 'You' ? 10 : 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
          .bindTooltip(label, { permanent: true, direction, offset: direction === 'left' ? [-10, 0] : [10, 0] }).addTo(pins.current);
      }
      map.current.fitBounds(L.latLngBounds([me.latitude, me.longitude], [peer.latitude, peer.longitude]), { padding: [110, 50], maxZoom: 17 });
    });
    return () => { cancelled = true; };
  }, [me, peer, peerName, ready]);
  return <><div ref={element} role="region" aria-label={`Meetup map showing you and ${peerName}`} style={{ width: '100%', height: 320, minWidth: 0, borderRadius: 8, overflow: 'hidden', isolation: 'isolate', backgroundColor: '#EDF1F2' }} />{error && <Notice error>{error}</Notice>}</>;
}
