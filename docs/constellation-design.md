# Constellation frontend

## Direction

Dark neutral-purple foundations, lilac accents and white text. Connection preferences
use white (liked), red (disliked) and lilac (unrated), with text labels as well as color.
The stars are a visual metaphor, not a scientific classification or geographic map.
Their positions are deterministic from request IDs and reveal no location. Lines
join the viewer at the center to their connections; no peer-to-peer friendship is inferred.

Existing page layouts remain; Matches gets an unframed interactive Three.js scene,
full-set ranked search, segmented filters, six-card pages and accessible pagination dots.
Connection details expand in place. Errors remain visible without the old Retry button.

## Research and library choice

- [React Native practitioner discussion](https://www.reddit.com/r/reactnative/comments/1hwq6hp/)
  describes a shipped app using React Three Fiber, Skia and Reanimated. This is
  community experience, not a compatibility guarantee.
- [Expo glass discussion](https://www.reddit.com/r/expo/comments/1oflg9x/how_i_integrated_liquid_glass_in_my_expo_app_and/)
  emphasizes contrast, accessibility fallbacks and the layout work glass requires.
- [R3F official installation guidance](https://r3f.docs.pmnd.rs/getting-started/installation)
  pairs Fiber 9 with React 19 and documents native support through Expo GL/Asset.
- [Expo SDK 54 GLView](https://docs.expo.dev/versions/v54.0.0/sdk/gl-view/)
  and [BlurView](https://docs.expo.dev/versions/v54.0.0/sdk/blur-view/)
  are the version-specific implementation references.

Selected: Three.js + React Three Fiber 9; Expo GL/Asset on native; existing Expo
LinearGradient; BlurView only on navigation, with opaque Android/reduced-transparency
fallbacks. No replacement component framework or heavy bloom/postprocessing stack.
This is a cross-platform glass-inspired treatment, not Apple's native Liquid Glass API.

The supplied [DeepSeek redesign](https://dribbble.com/shots/27561837-AI-Chat-App-UI-Design-DeepSeek-Redesign)
informed purple materials; [Affirmation onboarding](https://dribbble.com/shots/25946727-Affirmation-App-Onboarding)
informed quieter dark surfaces; the [AI chatbot case study](https://dribbble.com/shots/26843943-AI-Chatbot-Mobile-App-UI-UX-Design-Case-Study)
and [space landing page](https://dribbble.com/shots/21435014-Space-Themed-Landing-Page)
were additional references. The supplied Phaenomena shot could not be retrieved;
no assets from these designs were copied into the app.

## Runtime and verification

- The graph endpoint returns all authorized visible connection nodes, separate from
  six-item card pagination. Search only covers disclosure-safe names, interests and
  mutually shared facts, never another user's private onboarding answers.
- Backgrounded or unfocused tabs hide the graph; web rendering pauses offscreen.
  Reduced motion stops automatic rotation; drag and explicit rotation/zoom controls remain.
- Web pixel ratio is capped at 1.5. Materials use a small procedural glow texture, not
  image downloads. Resource cleanup occurs on unmount.
- Install dependencies with `npm ci`. Native apps need a fresh development build
  after adding Expo GL/Blur/Asset. Physical iPhone testing is still necessary; a
  successful web preview is not evidence of native GPU compatibility.
- Apply the new graph migration after the ordered navigation prerequisites. See
  `database-migration-summary.md`. Do not show fabricated stars if the API is unavailable.

## Verification record

On 2026-09-26: TypeScript, Expo lint and Python Ruff checks passed; 134 frontend tests
and 183 focused API tests passed. Both web and iOS JavaScript/Hermes exports succeeded.
The fictional-only Playwright harness checks desktop (1280x900) and mobile (390x844),
WebGL pixels (including red/white nodes), rotation, dragging, reduced motion, pagination
dots, search, preferences, location-consent withdrawal and explicit error states.

SQL assertions were extended for graph actor isolation, all 13 fixture connections,
minimal fields and redaction after block/revoke. They could not be executed because
the dedicated local Docker database did not respond within the inspection timeout.
No shared Supabase migration was applied. Physical-device GPU testing remains open.

Dependency audit still reports four existing Expo/Metro transitive advisories
(three moderate, one high, in query-string/decode-uri-component and image-size).
No forced Expo downgrade or unrelated dependency migration was attempted in this UI patch.
