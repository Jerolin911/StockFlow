import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { OverviewDto, Paginated, TrendDto } from '@stockflow/shared';
import { apiDownload, apiRequest, type RequestOptions } from '@/lib/api-client';

type Query = RequestOptions['query'];

// Reports read live data, so any stock or document change can move them.
const KEY = 'reports';

export function useOverview() {
  return useQuery({
    queryKey: [KEY, 'overview'],
    queryFn: ({ signal }) =>
      apiRequest<{ data: OverviewDto }>('/reports/overview', { signal }).then((r) => r.data),
    refetchInterval: 60_000,
  });
}

export function useReport<T>(path: string, params: Query, enabled = true) {
  return useQuery<T>({
    queryKey: [KEY, path, params],
    queryFn: ({ signal }) =>
      apiRequest<{ data: T }>(`/reports${path}`, { query: params, signal }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useReportPage<T>(path: string, params: Query, enabled = true) {
  return useQuery<Paginated<T>>({
    queryKey: [KEY, path, params],
    queryFn: ({ signal }) => apiRequest<Paginated<T>>(`/reports${path}`, { query: params, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const useTrend = (path: string, params: Query, enabled = true) =>
  useReport<TrendDto>(path, params, enabled);

export const downloadReport = (path: string, params: Query) =>
  apiDownload(`/reports${path}`, {
    ...params,
    format: 'csv',
    page: undefined,
    pageSize: undefined,
  });
