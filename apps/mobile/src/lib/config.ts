export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, ''),
};
export const authConfigured = !!config.supabaseUrl && !!config.supabaseKey;
