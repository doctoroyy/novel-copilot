import { createContext, useContext, type ReactNode } from 'react';
import type { User } from '@/lib/auth';

/**
 * Local-first: no authentication required.
 * Always provides a local admin user for API compatibility.
 */

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isLoggedIn: boolean;
  refreshUser: () => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const LOCAL_USER: User = {
  id: 'local-user',
  username: 'local',
  role: 'admin',
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const value: AuthContextType = {
    user: LOCAL_USER,
    loading: false,
    error: null,
    isLoggedIn: true,
    refreshUser: async () => true,
    login: async () => true,
    register: async () => true,
    logout: async () => {},
    clearError: () => {},
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
