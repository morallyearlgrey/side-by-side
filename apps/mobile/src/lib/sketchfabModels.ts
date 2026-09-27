export type SketchfabModelKey = 'mars' | 'planet' | 'venus' | 'glasses';

export const sketchfabModels = {
  mars: {
    id: '48d0e419c98342cfa3b5619e3525da51',
    title: 'The Planet Mars 3D Globe',
    creator: 'v7x',
    thumbnail: 'https://media.sketchfab.com/models/48d0e419c98342cfa3b5619e3525da51/thumbnails/e7ba47440c40490e9e63d3b52c4fbbde/bc1b62e258884e05bc6424b937e83b3f.jpeg',
    url: 'https://sketchfab.com/3d-models/the-planet-mars-3d-globe-48d0e419c98342cfa3b5619e3525da51',
    credit: 'Mars model by v7x on Sketchfab',
  },
  planet: {
    id: 'a1494d5d4f2d40428ecf6ea93a2112fd',
    title: 'Planet',
    creator: 'dubson',
    thumbnail: 'https://media.sketchfab.com/models/a1494d5d4f2d40428ecf6ea93a2112fd/thumbnails/337584e3483a4137827bedac1eb3a8a4/e979372a2e654b05b2934813c3cdc91e.jpeg',
    url: 'https://sketchfab.com/3d-models/planet-a1494d5d4f2d40428ecf6ea93a2112fd',
    credit: 'Planet by dubson · CC BY',
  },
  venus: {
    id: '0ee66cfcebd44c75aa88a57339250e94',
    title: 'Planet Venus',
    creator: 'butcher.cnd',
    thumbnail: 'https://media.sketchfab.com/models/0ee66cfcebd44c75aa88a57339250e94/thumbnails/ef689a514e6a41e29759a0716626cf91/720x405.jpeg',
    url: 'https://sketchfab.com/3d-models/planet-venus-0ee66cfcebd44c75aa88a57339250e94',
    credit: 'Venus by butcher.cnd · CC BY',
  },
  glasses: {
    id: 'c37e201c0f4a49deb2415b4949e011e7',
    title: 'Lowpoly VR glasses',
    creator: 'taigo',
    thumbnail: 'https://media.sketchfab.com/models/c37e201c0f4a49deb2415b4949e011e7/thumbnails/1aa2253197004d50a665b4b357cb8720/cd6e335faa17432a8e73031b5ad3f249.jpeg',
    url: 'https://sketchfab.com/3d-models/lowpoly-vr-glasses-c37e201c0f4a49deb2415b4949e011e7',
    credit: 'VR glasses concept by taigo · CC BY',
  },
} as const;
