// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Permission, UserDto } from '@stockflow/shared';
import { AuthContext, type AuthState } from './auth-context';
import { GuestOnly, RequireAuth, RequirePermission } from './guards';

const user: UserDto = {
  id: 'u1',
  name: 'Sam',
  email: 'sam@stockflow.test',
  role: 'staff',
  isActive: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? 'none';
  return <p>Login page (from: {from})</p>;
}

function renderAt(path: string, state: AuthState) {
  return render(
    <AuthContext.Provider
      value={{ state, login: async () => {}, logout: async () => {}, setUser: () => {} }}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<GuestOnly />}>
            <Route path="/login" element={<LoginProbe />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<p>Dashboard</p>} />
            <Route path="/change-password" element={<p>Change password</p>} />
            <Route element={<RequirePermission permission="users:manage" />}>
              <Route path="/users" element={<p>Users</p>} />
            </Route>
            <Route path="/orders" element={<p>Orders</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const signedIn = (permissions: Permission[], overrides: Partial<UserDto> = {}): AuthState => ({
  status: 'authenticated',
  user: { ...user, ...overrides },
  permissions,
});

describe('route guards', () => {
  it('sends anonymous visitors to sign in and remembers where they were going', () => {
    renderAt('/orders?status=draft', { status: 'anonymous', reason: 'expired' });
    expect(screen.getByText('Login page (from: /orders?status=draft)')).toBeInTheDocument();
  });

  it('forgets the previous page after a deliberate sign-out', () => {
    renderAt('/orders', { status: 'anonymous', reason: 'signed_out' });
    expect(screen.getByText('Login page (from: none)')).toBeInTheDocument();
  });

  it('shows access denied for pages the role lacks', () => {
    renderAt('/users', signedIn([]));
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
  });

  it('lets permitted users through', () => {
    renderAt('/users', signedIn(['users:manage']));
    expect(screen.getByText('Users')).toBeInTheDocument();
  });

  it('forces a password change before anything else', () => {
    renderAt('/orders', signedIn([], { mustChangePassword: true }));
    expect(screen.getByText('Change password')).toBeInTheDocument();
  });

  it('keeps signed-in users away from the sign-in page', () => {
    renderAt('/login', signedIn([]));
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
