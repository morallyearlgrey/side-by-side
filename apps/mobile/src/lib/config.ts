import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { resolveApiUrl } from './apiUrl';

const apiUrl = resolveApiUrl({
  platform: Platform.OS,
  development: __DEV__,
  followMetroHost: process.env.EXPO_PUBLIC_NATIVE_API_FOLLOW_METRO === 'true',
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  nativeApiUrl: process.env.EXPO_PUBLIC_NATIVE_API_URL,
  metroHostUri: Constants.expoConfig?.hostUri,
});

export const config = {
  googleMapsWebKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY || '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
  apiUrl,
};
export const authConfigured = !!config.supabaseUrl && !!config.supabaseKey;
