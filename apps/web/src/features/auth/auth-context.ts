import { createContext, useContext } from 'react';
import type { LoginInput, Permission, UserDto } from '@stockflow/shared';

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: 'expired' }
  | { status: 'authenticated'; user: UserDto; permissions: Permission[] };

export interface AuthContextValue {
  state: AuthState;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: UserDto) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** For components rendered only behind RequireAuth. */
export function useCurrentUser() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('No authenticated user');
  return state;
}

export function usePermission(permission: Permission): boolean {
  const { state } = useAuth();
  return state.status === 'authenticated' && state.permissions.includes(permission);
}
