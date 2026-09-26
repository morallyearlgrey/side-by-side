import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { focusManager } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/query';

const AuthContext = createContext<{ session: Session | null; loading: boolean }>({ session: null, loading: true });
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const owner = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active = true;
    const apply = (next: Session | null) => {
      if (!active) return;
      if (owner.current !== next?.user.id) { queryClient.clear(); owner.current = next?.user.id; }
      setSession(next); setLoading(false);
    };
    void supabase.auth.getSession().then(({ data }) => apply(data.session)).catch(() => apply(null));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => apply(next));
    const sub = AppState.addEventListener('change', state => {
      focusManager.setFocused(state === 'active');
      if (state === 'active') supabase?.auth.startAutoRefresh(); else supabase?.auth.stopAutoRefresh();
    });
    return () => { active = false; data.subscription.unsubscribe(); sub.remove(); };
  }, []);
  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
