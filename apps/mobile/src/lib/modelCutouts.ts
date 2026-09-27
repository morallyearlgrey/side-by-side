import type { SketchfabModelKey } from './sketchfabModels';

// Transparent illustrations based on the credited Sketchfab references.
// The interactive models remain available through Sketchfab on demand.
export const modelCutouts: Record<SketchfabModelKey, number> = {
  mars: require('../../assets/cosmic/mars-cutout.png'),
  planet: require('../../assets/cosmic/planet-cutout.png'),
  venus: require('../../assets/cosmic/venus-cutout.png'),
  glasses: require('../../assets/cosmic/vr-glasses-cutout.png'),
};
