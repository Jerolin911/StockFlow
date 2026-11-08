import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LoginInput, SessionDto, UserDto } from '@stockflow/shared';
import { apiRequest, refreshSession, setAccessToken, setSessionListeners } from '@/lib/api-client';
import { AuthContext, type AuthState } from './auth-context';

const fromSession = (session: SessionDto): AuthState => ({
  status: 'authenticated',
  user: session.user,
  permissions: session.permissions,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    setSessionListeners({
      onRefreshed: (session) => setState(fromSession(session)),
      onEnded: () => {
        setAccessToken(null);
        queryClient.clear();
        setState({ status: 'anonymous', reason: 'expired' });
      },
    });

    let cancelled = false;
    void refreshSession().then((session) => {
      if (!cancelled) setState(session ? fromSession(session) : { status: 'anonymous' });
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const login = useCallback(async (input: LoginInput) => {
    const { data } = await apiRequest<{ data: SessionDto }>('/auth/login', {
      method: 'POST',
      body: input,
    });
    setAccessToken(data.accessToken);
    setState(fromSession(data));
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      queryClient.clear();
      setState({ status: 'anonymous', reason: 'signed_out' });
    }
  }, [queryClient]);

  const setUser = useCallback((user: UserDto) => {
    setState((current) => (current.status === 'authenticated' ? { ...current, user } : current));
  }, []);

  const value = useMemo(() => ({ state, login, logout, setUser }), [state, login, logout, setUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
