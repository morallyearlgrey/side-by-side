import { Platform } from 'react-native';

const apiUrl = Platform.OS === 'web'
  ? process.env.EXPO_PUBLIC_API_URL
  : process.env.EXPO_PUBLIC_NATIVE_API_URL || process.env.EXPO_PUBLIC_API_URL;

export const config = {
  googleMapsWebKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY || '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
  apiUrl: (apiUrl || '').replace(/\/$/, ''),
};
export const authConfigured = !!config.supabaseUrl && !!config.supabaseKey;
