import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '../types/domain';
import { clearToken, getToken, setToken } from '../lib/storage';
import { fetchCurrentUser, login as loginRequest, register as registerRequest } from '../lib/api';
import { useAppConfig } from './AppConfigContext';

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string, invitationCode: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { config, loading: configLoading } = useAppConfig();
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    if (configLoading) return;

    setLoading(true);
    setError(null);

    try {
      const storedToken = await getToken();
      if (!storedToken) {
        setTokenState(null);
        setUser(null);
        return;
      }

      setTokenState(storedToken);
      const me = await fetchCurrentUser(config.apiBaseUrl, storedToken);
      if (!me.success || !me.user) {
        await clearToken();
        setTokenState(null);
        setUser(null);
        return;
      }

      setUser(me.user);
    } catch (err) {
      setError((err as Error).message);
      setUser(null);
      setTokenState(null);
    } finally {
      setLoading(false);
    }
  }, [config.apiBaseUrl, configLoading]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await loginRequest(config.apiBaseUrl, username, password);
      if (!result.success || !result.token || !result.user) {
        setError(result.error || '登录失败');
        return false;
      }

      await setToken(result.token);
      setTokenState(result.token);
      setUser(result.user);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [config.apiBaseUrl]);

  const register = useCallback(async (username: string, password: string, invitationCode: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await registerRequest(config.apiBaseUrl, username, password, invitationCode);
      if (!result.success || !result.token || !result.user) {
        setError(result.error || '注册失败');
        return false;
      }

      await setToken(result.token);
      setTokenState(result.token);
      setUser(result.user);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [config.apiBaseUrl]);

  const logout = useCallback(async () => {
    await clearToken();
    setUser(null);
    setTokenState(null);
    setError(null);
  }, []);

  const clearErrorState = useCallback(() => {
    setError(null);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!token) return;
    const me = await fetchCurrentUser(config.apiBaseUrl, token);
    if (me.success && me.user) {
      setUser(me.user);
      return;
    }

    await clearToken();
    setUser(null);
    setTokenState(null);
  }, [config.apiBaseUrl, token]);

  const isLoggedIn = Boolean(user && token);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    loading,
    error,
    isLoggedIn,
    login,
    register,
    logout,
    clearError: clearErrorState,
    refreshMe,
  }), [clearErrorState, error, isLoggedIn, loading, login, logout, refreshMe, register, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
