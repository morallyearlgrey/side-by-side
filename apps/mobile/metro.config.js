const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const threeModule = path.join(path.dirname(require.resolve('three')), 'three.module.js');
// Expo watches workspace packages by default, but shared JSON is not a package.
config.watchFolders = [...new Set([...config.watchFolders, path.resolve(__dirname, '../../shared')])];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Three's CommonJS wrapper uses Node-only process.emitWarning. Keep Fiber
  // and app imports on the same ESM build when running under React Native.
  const target = moduleName === 'three' && (platform === 'ios' || platform === 'android')
    ? threeModule
    : moduleName;
  return context.resolveRequest(context, target, platform);
};

module.exports = config;
