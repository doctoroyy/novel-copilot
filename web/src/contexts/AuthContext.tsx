import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User } from '@/lib/auth';
import { 
  login as apiLogin, 
  register as apiRegister, 
  logout as apiLogout, 
  getCurrentUser,
  isAuthenticated,
} from '@/lib/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isLoggedIn: boolean;
  refreshUser: () => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string, invitationCode: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated()) {
      setUser(null);
      return false;
    }

    try {
      const response = await getCurrentUser();
      if (response.success && response.user) {
        setUser(response.user);
        return true;
      }
      setUser(null);
      return false;
    } catch {
      setUser(null);
      return false;
    }
  }, []);

  // Check if user is logged in on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (!isAuthenticated()) {
        setLoading(false);
        return;
      }

      try {
        await refreshUser();
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [refreshUser]);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    setError(null);
    setLoading(true);

    try {
      const response = await apiLogin(username, password);
      if (response.success && response.user) {
        setUser(response.user);
        return true;
      } else {
        setError(response.error || '登录失败');
        return false;
      }
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (
    username: string, 
    password: string, 
    invitationCode: string
  ): Promise<boolean> => {
    setError(null);
    setLoading(true);

    try {
      const response = await apiRegister(username, password, invitationCode);
      if (response.success && response.user) {
        setUser(response.user);
        return true;
      } else {
        setError(response.error || '注册失败');
        return false;
      }
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    error,
    isLoggedIn: !!user,
    refreshUser,
    login,
    register,
    logout,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
