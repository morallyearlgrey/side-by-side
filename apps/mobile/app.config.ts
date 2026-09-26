import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'SidebySide',
  slug: 'side-by-side',
  scheme: 'sidebyside',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    config: process.env.GOOGLE_MAPS_IOS_API_KEY ? { googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY } : undefined,
    bundleIdentifier: 'app.sidebyside.mobile',
    supportsTablet: false,
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: 'Find other people using SidebySide nearby when you turn Live on.',
      NSLocalNetworkUsageDescription: 'Connect to your SidebySide development server on your local network.',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: { package: 'app.sidebyside.mobile', config: process.env.GOOGLE_MAPS_ANDROID_API_KEY ? { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } } : undefined },
  extra: { googleMapsIosConfigured: !!process.env.GOOGLE_MAPS_IOS_API_KEY, googleMapsAndroidConfigured: !!process.env.GOOGLE_MAPS_ANDROID_API_KEY },
  plugins: [
    './plugins/withReactNativeScriptSandboxing',
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    ['expo-location', { locationWhenInUsePermission: 'Show people within two miles while you use SidebySide. Your precise location stays private.' }],
    ['expo-image-picker', { photosPermission: 'Choose photos to review before importing. Nothing is shared automatically.', cameraPermission: false, microphonePermission: false }],
  ],
  experiments: { typedRoutes: true },
  web: { bundler: 'metro', output: 'single' },
};
export default config;
