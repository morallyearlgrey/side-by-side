# Approximate discovery map

`GET /v1/discovery/location-map` uses the verified account from the bearer session. It takes no account or coordinate input. The service-only `discovery_location_map` SQL function rechecks current consent, availability, approved previews, blocks, hard filters, discovery settings and observation leases in one database snapshot. It returns eligible nearby detections independently of model recommendations. Finding a nearby person does not imply compatibility or mutual acceptance.

## Geographic location

Both viewer and peer coordinates are rounded into fixed `0.003°` cells (roughly 334 m north to south). Circles add up to 240 m for rounding plus the observation accuracy, rounded upward to 50 m. Exact stored coordinates, raw profile facts, session tokens and RSSI are never returned. Stable cells avoid repeated random samples revealing the original location. Circles express estimation uncertainty, not guaranteed containment of a moving person.

Both people must have location discovery enabled, current observations no older than five minutes, reported accuracy at most 250 m, and valid previews/consent. Peer discovery also respects the viewer's configured radius. Turning off location sharing prevents reuse of remembered GPS, even when a Bluetooth encounter remains valid.

## Bluetooth

A radio encounter must belong to the requesting observer, be at most two minutes old, reference an active peer session, and pass the existing BLE eligibility checks. One observer's sighting does not invent a reverse sighting.

RSSI cannot determine latitude, longitude or direction. A Bluetooth-only peer has **no geographic pin**. With a current viewer location, the map shades an illustrative area around the viewer, with viewer uncertainty plus a coarse radio band: strong (30 m), moderate (100 m), or weak/unknown (250 m). These bands are interface approximations, not measured distances or reliable maximum ranges; obstructions, hardware and interference can change signal strength. Without viewer location, detection can be listed but not plotted.

## Rendering and privacy

The Google Maps interface draws coarse area centers and uncertainty circles. It draws no routes and no Bluetooth peer marker. Client checks remove expired map areas without waiting for a new poll. Polling is scoped to the current account, stops when Connect loses focus or the app goes to the background, and clears displayed data on request failure or disabling discovery. Responses use the API's `Cache-Control: no-store` policy. Displaying a Google map sends coarse areas to Google; exact location remains on the matching backend.

## Configuration

- Web: `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`, with Maps JavaScript API enabled. Restrict the key to approved website origins and that API. It is a public browser credential, supplied through environment configuration, never hardcoded.
- iOS: `GOOGLE_MAPS_IOS_API_KEY`, Maps SDK for iOS enabled and app bundle restrictions.
- Android: `GOOGLE_MAPS_ANDROID_API_KEY`, Maps SDK for Android enabled and app/package signing restrictions.

The existing `react-native-maps` dependency is reused. Native Google Maps requires a rebuilt native binary after key/native SDK setup; a running Metro server cannot add the SDK to an already installed app. The interface clearly reports missing native configuration while keeping text estimates available. Browser Bluetooth discovery remains unavailable; web maps use geographic location.

Run `supabase/tests/discovery_location_map.sql` after migrations and the fictional seed on a disposable database. It checks rounding, expiry, consent and preview revocation, blocks, one-way BLE observations, opted-out GPS and service-only access. Never import its fixtures into production.
