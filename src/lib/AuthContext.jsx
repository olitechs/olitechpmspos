import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authService } from '@/services/authService';
import { supabase } from '@/lib/supabaseClient';
import { setReturnTo, getReturnTo, clearReturnTo } from '@/lib/authReturnTo';

const AuthContext = createContext(null);

// Preserve the previous user reference when a silent entitlement refresh returns equivalent data.
function sameUser(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

async function hasLiveSession() {
  try { const { data } = await supabase.auth.getSession(); return !!data?.session; } catch { return false; }
}

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoadingPublicSettings] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const userRef = useRef(null);
  const authCheckSequenceRef = useRef(0);
  const userRefreshSequenceRef = useRef(0);

  const applyUser = useCallback((next) => {
    userRef.current = next;
    setUser((previous) => (sameUser(previous, next) ? previous : next));
  }, []);

  const checkUserAuth = useCallback(async () => {
    const requestId = ++authCheckSequenceRef.current;
    userRefreshSequenceRef.current += 1;
    const hadUser = !!userRef.current;
    if (!hadUser) setIsLoadingAuth(true);
    try {
      const current = await authService.getCurrentUser();
      if (requestId !== authCheckSequenceRef.current) return;
      if (current) {
        applyUser(current);
        setAuthError(null);
      } else if (hadUser && await hasLiveSession()) {
        // A transient profile/network failure must not unmount a live workspace.
      } else {
        if (requestId !== authCheckSequenceRef.current) return;
        applyUser(null);
        setAuthError({ type: 'auth_required' });
      }
    } catch (err) {
      if (requestId === authCheckSequenceRef.current && !hadUser) {
        applyUser(null);
        setAuthError({ type: 'auth_required', message: err?.message });
      }
    } finally {
      if (requestId === authCheckSequenceRef.current) {
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    }
  }, [applyUser]);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  // Silent entitlement revalidation (Phase 4/6): a browser tab left open
  // across a subscription expiry must not keep a stale active status. The
  // database entitlement is re-fetched on focus/visibility and on a bounded
  // interval — without flipping isLoadingAuth, so no skeleton flash. The
  // realtime listeners above already cover platform-side changes; this covers
  // pure time-based expiry. The database check remains authoritative.
  const refreshUser = useCallback(async () => {
    const requestId = ++userRefreshSequenceRef.current;
    const authRequestId = authCheckSequenceRef.current;
    try {
      const current = await authService.getCurrentUser();
      if (requestId === userRefreshSequenceRef.current && authRequestId === authCheckSequenceRef.current && current) applyUser(current);
    } catch {
      // Keep the current session on transient failures; the next tick retries.
    }
  }, [applyUser]);

  useEffect(() => {
    if (!user || user.isPlatformOwner) return undefined;
    const FOCUS_RECHECK_MS = 5 * 60 * 1000;
    const recheck = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      refreshUser();
    };
    const interval = setInterval(recheck, FOCUS_RECHECK_MS);
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [user?.id, user?.isPlatformOwner, refreshUser]);

  // Keep React auth state synchronized with the real Supabase session.
  // This covers token refresh, sign-out in another tab, and sign-in/session
  // restoration events instead of relying on the initial page load only.
  useEffect(() => {
    let disposed = false;
    let timer = null;
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')
        && userRef.current && session?.user?.id === userRef.current.id) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { if (!disposed) checkUserAuth(); }, 0);
    });
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      subscription?.subscription?.unsubscribe();
    };
  }, [checkUserAuth]);

  // Platform Admin changes (package/status/subscription/member assignment) are
  // authoritative in Postgres. Listen to the current property's records so
  // access changes become effective without requiring logout/login or a hard refresh.
  useEffect(() => {
    const propertyId = user?.property?.id;
    if (!propertyId || user?.isPlatformOwner) return undefined;
    const channel = supabase
      .channel(`property-access-${propertyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties', filter: `id=eq.${propertyId}` }, () => checkUserAuth())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'property_subscriptions', filter: `property_id=eq.${propertyId}` }, () => checkUserAuth())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'property_users', filter: `property_id=eq.${propertyId}` }, () => checkUserAuth())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.property?.id, user?.isPlatformOwner, checkUserAuth]);

  const navigateToLogin = useCallback(() => {
    setReturnTo(location.pathname + location.search);
    navigate('/login', { replace: true });
  }, [navigate, location]);

  const login = useCallback(async (email, password, options = {}) => {
    const loggedInUser = await authService.login({ email, password });
    authCheckSequenceRef.current += 1;
    userRefreshSequenceRef.current += 1;
    applyUser(loggedInUser);
    setAuthError(null);
    setAuthChecked(true);
    const dest = options.redirectTo || (loggedInUser?.isPlatformOwner ? '/admin' : getReturnTo('/'));
    clearReturnTo();
    // Dedicated admin login must validate the account role before navigating;
    // otherwise a property account can be redirected away before the denial is shown.
    if (options.navigate !== false) navigate(dest, { replace: true });
    return loggedInUser;
  }, [navigate, applyUser]);

  const register = useCallback(async ({ name, email, password, businessName }) => {
    const result = await authService.register({ name, email, password, businessName });
    if (result?.needsEmailConfirmation) {
      setAuthChecked(true);
      return result;
    }
    authCheckSequenceRef.current += 1;
    userRefreshSequenceRef.current += 1;
    applyUser(result);
    setAuthError(null);
    setAuthChecked(true);
    navigate('/', { replace: true });
    return result;
  }, [navigate, applyUser]);

  const logout = useCallback(async () => {
    authCheckSequenceRef.current += 1;
    userRefreshSequenceRef.current += 1;
    await authService.logout();
    applyUser(null);
    try {
      sessionStorage.removeItem('olitech_module_access_v2');
      sessionStorage.removeItem('olitech_active_staff_v2');
    } catch {}
    setAuthError({ type: 'auth_required' });
    navigate('/login', { replace: true });
  }, [navigate, applyUser]);

  const value = useMemo(() => ({
    user,
    isAuthenticated: !!user,
    isLoadingAuth,
    isLoadingPublicSettings,
    authChecked,
    authError,
    checkUserAuth,
    navigateToLogin,
    login,
    register,
    logout,
  }), [user, isLoadingPublicSettings, isLoadingAuth, authChecked, authError, checkUserAuth, navigateToLogin, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
