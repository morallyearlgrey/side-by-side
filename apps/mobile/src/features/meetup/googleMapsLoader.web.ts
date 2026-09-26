type GoogleMap = { fitBounds: (bounds: unknown, padding?: number) => void };
type Overlay = { setMap: (map: GoogleMap | null) => void };
export type GoogleMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => Overlay;
  Polyline: new (options: Record<string, unknown>) => Overlay;
  Circle: new (options: Record<string, unknown>) => Overlay;
  LatLngBounds: new () => { extend: (point: { lat: number; lng: number }) => void };
  SymbolPath: { CIRCLE: unknown };
  event: { clearInstanceListeners: (instance: unknown) => void };
};
declare global { interface Window { google?: { maps: GoogleMaps }; sidebysideMapsReady?: () => void; gm_authFailure?: () => void } }
let loading: Promise<GoogleMaps> | null = null;

export function loadGoogleMaps(key: string): Promise<GoogleMaps> {
  if (!key) return Promise.reject(new Error('Google Maps web setup required.'));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timeout); script.remove(); loading = null; reject(new Error('Google Maps could not load. Check the web key and allowed origin.')); };
    const timeout = setTimeout(fail, 15_000);
    window.gm_authFailure = () => { window.dispatchEvent(new Event('sidebyside-maps-auth-error')); fail(); };
    window.sidebysideMapsReady = () => {
      clearTimeout(timeout);
      if (window.google?.maps) resolve(window.google.maps); else fail();
      delete window.sidebysideMapsReady;
    };
    script.async = true; script.onerror = fail;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=quarterly&loading=async&callback=sidebysideMapsReady`;
    document.head.appendChild(script);
  });
  return loading;
}
