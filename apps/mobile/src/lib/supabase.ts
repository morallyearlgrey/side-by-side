import 'react-native-url-polyfill/auto';
import { createClient, processLock } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { authConfigured, config } from './config';

const storage = {
  async getItem(key: string) {
    if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === 'web') { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); return; }
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string) {
    if (Platform.OS === 'web') { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); return; }
    await SecureStore.deleteItemAsync(key);
  },
};
export const supabase = authConfigured ? createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce', lock: processLock },
}) : null;
