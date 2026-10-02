import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authService } from '@/services/authService';
import { supabase } from '@/lib/supabaseClient';
import { setReturnTo, getReturnTo, clearReturnTo } from '@/lib/authReturnTo';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoadingPublicSettings] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const current = await authService.getCurrentUser();
      if (current) {
        setUser(current);
        setAuthError(null);
      } else {
        setUser(null);
        setAuthError({ type: 'auth_required' });
      }
    } catch (err) {
      setUser(null);
      setAuthError({ type: 'auth_required', message: err?.message });
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  // Keep React auth state synchronized with the real Supabase session.
  // This covers token refresh, sign-out in another tab, and sign-in/session
  // restoration events instead of relying on the initial page load only.
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION') return;
      checkUserAuth();
    });
    return () => subscription?.subscription?.unsubscribe();
  }, [checkUserAuth]);

  const navigateToLogin = useCallback(() => {
    setReturnTo(location.pathname + location.search);
    navigate('/login', { replace: true });
  }, [navigate, location]);

  const login = useCallback(async (email, password) => {
    const loggedInUser = await authService.login({ email, password });
    setUser(loggedInUser);
    localStorage.setItem('olitech_token', 'supabase_session');
    setAuthError(null);
    setAuthChecked(true);
    const dest = getReturnTo('/');
    clearReturnTo();
    navigate(dest, { replace: true });
    return loggedInUser;
  }, [navigate]);

  const register = useCallback(async ({ name, email, password, businessName }) => {
    const result = await authService.register({ name, email, password, businessName });
    if (result?.needsEmailConfirmation) {
      setAuthChecked(true);
      return result;
    }
    setUser(result);
    localStorage.setItem('olitech_token', 'supabase_session');
    setAuthError(null);
    setAuthChecked(true);
    navigate('/', { replace: true });
    return result;
  }, [navigate]);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    localStorage.removeItem('olitech_token');
    try {
      sessionStorage.removeItem('olitech_module_access_v2');
      sessionStorage.removeItem('olitech_active_staff_v2');
    } catch {}
    setAuthError({ type: 'auth_required' });
    navigate('/login', { replace: true });
  }, [navigate]);

  const value = {
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
