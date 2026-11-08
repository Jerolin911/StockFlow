import { useQuery } from '@tanstack/react-query';
import type { NotificationDto, PendingApprovalsDto } from '@stockflow/shared';
import { apiRequest, type RequestOptions } from '@/lib/api-client';
import { useApiMutation, useListQuery } from '@/lib/query';

export const useNotifications = (params: RequestOptions['query']) =>
  useListQuery<NotificationDto>('notifications', '/notifications', params);

/** Unread count and approvals waiting for the user; polled so the bell stays current. */
export function useNotificationSummary() {
  return useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: ({ signal }) =>
      apiRequest<{ data: { unread: number; approvals: PendingApprovalsDto } }>(
        '/notifications/summary',
        {
          signal,
        },
      ).then((r) => r.data),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export const useMarkRead = () =>
  useApiMutation(
    (id: string) =>
      apiRequest<{ data: NotificationDto }>(`/notifications/${id}/read`, { method: 'POST' }),
    ['notifications'],
  );

export const useMarkAllRead = () =>
  useApiMutation(
    () => apiRequest<{ data: { updated: number } }>('/notifications/read-all', { method: 'POST' }),
    ['notifications'],
  );
