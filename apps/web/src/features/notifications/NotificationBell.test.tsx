// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationDto } from '@stockflow/shared';
import type * as ApiClient from '@/lib/api-client';
import { NotificationBell } from './NotificationBell';

const apiRequest = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const notification = (overrides: Partial<NotificationDto>): NotificationDto => ({
  id: 'n1',
  type: 'transfer',
  title: 'TRF-2026-00004 needs approval',
  body: '3 units requested by Sam',
  link: '/stock/transfers/t4',
  readAt: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<NotificationBell />} />
          <Route path="/stock/transfers/:id" element={<p>Transfer page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation((path: string) => {
    if (path === '/notifications/summary') {
      return Promise.resolve({
        data: {
          unread: 2,
          approvals: {
            purchaseRequests: 0,
            purchaseOrders: 1,
            transfers: 1,
            customerReturns: 0,
            supplierReturns: 0,
            stockCounts: 0,
            total: 2,
          },
        },
      });
    }
    if (path === '/notifications') {
      return Promise.resolve({
        data: [
          notification({}),
          notification({
            id: 'n2',
            title: 'PO-2026-00009 approved',
            readAt: '2026-11-08T10:00:00Z',
            link: '',
          }),
        ],
        meta: { page: 1, pageSize: 8, total: 2 },
      });
    }
    return Promise.resolve({ data: notification({ readAt: new Date().toISOString() }) });
  });
});

describe('NotificationBell', () => {
  it('shows the unread count, approvals waiting and the latest notifications', async () => {
    renderBell();
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(bell).toHaveTextContent('2');
    await userEvent.click(bell);
    expect(screen.getByText('Waiting for your approval')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Purchase orders\s*1/ })).toHaveAttribute(
      'href',
      '/purchase-orders?status=pending_approval',
    );
    expect(screen.queryByRole('menuitem', { name: /Purchase requests/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /TRF-2026-00004 needs approval/ }),
    ).toHaveTextContent('Unread');
  });

  it('marks a notification read and opens its record', async () => {
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /TRF-2026-00004 needs approval/ }));
    expect(await screen.findByText('Transfer page')).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith('/notifications/n1/read', { method: 'POST' });
  });

  it('marks everything read at once', async () => {
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('/notifications/read-all', { method: 'POST' }),
    );
  });
});
