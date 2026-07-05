'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { api } from './api';
import { DEFAULT_COMPANY_ID } from './config';

export interface AuthUser {
  id: string;
  fullName: string;
  login: string;
  role: string | null;
  permissions: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  loginPin: (pin: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Применяем сохранённую тему как можно раньше
  useEffect(() => {
    if (localStorage.getItem('pp_theme') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  useEffect(() => {
    const resetAuth = () => setUser(null);
    window.addEventListener('pp:unauthorized', resetAuth);
    return () => window.removeEventListener('pp:unauthorized', resetAuth);
  }, []);

  // При загрузке — если есть токен, узнаём кто мы
  useEffect(() => {
    const token = localStorage.getItem('pp_token');
    if (!token) {
      const id = window.setTimeout(() => setLoading(false), 0);
      return () => window.clearTimeout(id);
    }
    api
      .get<AuthUser>('/auth/me')
      .then((me) => setUser(me))
      .catch(() => {
        localStorage.removeItem('pp_token');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (login: string, password: string) => {
    const res = await api.post<{ token: string }>('/auth/login', {
      companyId: DEFAULT_COMPANY_ID,
      login,
      password,
    });
    localStorage.setItem('pp_token', res.token);
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me);
  }, []);

  // Быстрый вход кассира по PIN
  const loginPin = useCallback(async (pin: string) => {
    const res = await api.post<{ token: string }>('/auth/pos-login', {
      companyId: DEFAULT_COMPANY_ID,
      pin,
    });
    localStorage.setItem('pp_token', res.token);
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('pp_token');
    setUser(null);
  }, []);

  const can = useCallback((permission: string) => {
    return !!user?.permissions?.includes(permission);
  }, [user]);

  const value = useMemo(
    () => ({ user, loading, login, loginPin, logout, can }),
    [user, loading, login, loginPin, logout, can],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен быть внутри AuthProvider');
  return ctx;
}
