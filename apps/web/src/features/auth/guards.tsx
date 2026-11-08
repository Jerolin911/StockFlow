import { Navigate, Outlet, useLocation } from 'react-router';
import type { Permission } from '@stockflow/shared';
import { FullPageLoader } from '@/components/FullPageLoader';
import { ForbiddenPage } from '@/components/StatusPages';
import { useAuth } from './auth-context';

export interface LoginRedirectState {
  from?: string;
}

export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <FullPageLoader />;
  if (state.status === 'anonymous') {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from } satisfies LoginRedirectState} />;
  }
  if (state.user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

export function GuestOnly() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <FullPageLoader />;
  if (state.status === 'authenticated') {
    const from = (location.state as LoginRedirectState | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }
  return <Outlet />;
}

export function RequirePermission({ permission }: { permission: Permission }) {
  const { state } = useAuth();
  if (state.status !== 'authenticated' || !state.permissions.includes(permission)) {
    return <ForbiddenPage />;
  }
  return <Outlet />;
}
