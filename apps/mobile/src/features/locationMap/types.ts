export type LocationArea = {
  latitude: number; longitude: number; uncertainty_m: number;
  observed_at: string; expires_at: string;
};
export type LocationEstimate = {
  user_id: string; display_name: string; source: 'location' | 'bluetooth';
  area: LocationArea | null; observed_at: string; expires_at: string;
  proximity: 'close' | 'nearby' | 'uncertain' | null;
};
export type LocationMapState = {
  status: 'ready' | 'location_unavailable' | 'off'; me: LocationArea | null;
  items: LocationEstimate[]; valid_until: string | null; refresh_after_seconds: number;
};
export type MapArea = LocationArea & { id: string; name: string; bluetooth: boolean; own: boolean };
export type MapVisualArea = Pick<MapArea, 'id' | 'name' | 'bluetooth' | 'own' | 'latitude' | 'longitude' | 'uncertainty_m'>;

export function visualAreas(areas: MapArea[]): MapVisualArea[] {
  return areas.map(({ id, name, bluetooth, own, latitude, longitude, uncertainty_m }) =>
    ({ id, name, bluetooth, own, latitude, longitude, uncertainty_m }));
}

export function isFreshArea(area: LocationArea | null, now: number): area is LocationArea {
  return !!area && Number.isFinite(area.latitude) && Number.isFinite(area.longitude)
    && Math.abs(area.latitude) <= 90 && Math.abs(area.longitude) <= 180
    && Number.isFinite(area.uncertainty_m) && area.uncertainty_m >= 250
    && Date.parse(area.expires_at) > now && Date.parse(area.observed_at) <= now + 5_000;
}

export function visibleEstimates(state: LocationMapState | null | undefined, now: number): LocationEstimate[] {
  if (!state || state.status === 'off' || !state.valid_until || !(Date.parse(state.valid_until) > now)) return [];
  return state.items.filter(item => Date.parse(item.expires_at) > now
    && Date.parse(item.observed_at) <= now + 5_000);
}

export function mapAreas(state: LocationMapState | null | undefined, now: number): MapArea[] {
  if (!state || state.status !== 'ready' || !state.valid_until
    || !(Date.parse(state.valid_until) > now) || !isFreshArea(state.me, now)) return [];
  const own = { ...state.me, id: 'me', name: 'You · approximate area', bluetooth: false, own: true };
  return [own, ...visibleEstimates(state, now).flatMap(item => isFreshArea(item.area, now)
    ? [{ ...item.area, id: item.user_id, name: item.display_name,
      bluetooth: item.source === 'bluetooth', own: false }] : [])];
}

export function areaBounds(area: Pick<LocationArea, 'latitude' | 'longitude' | 'uncertainty_m'>) {
  const latitudeDelta = area.uncertainty_m / 111_320;
  const longitudeDelta = latitudeDelta / Math.max(.01, Math.cos(area.latitude * Math.PI / 180));
  return [
    { lat: Math.min(90, area.latitude + latitudeDelta), lng: Math.min(180, area.longitude + longitudeDelta) },
    { lat: Math.max(-90, area.latitude - latitudeDelta), lng: Math.max(-180, area.longitude - longitudeDelta) },
  ];
}

export function estimateCaption(item: LocationEstimate) {
  if (item.source === 'bluetooth') {
    const strength = item.proximity === 'close' ? 'strong' : item.proximity === 'nearby' ? 'moderate' : 'weak or uncertain';
    return `Bluetooth detected · ${strength} signal. The shaded area is centered on you; direction and exact distance are unknown.`;
  }
  return `Approximate shared location · about ${Math.round(item.area?.uncertainty_m ?? 0)} m uncertainty. The circle includes location accuracy and privacy rounding.`;
}
