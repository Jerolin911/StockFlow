import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SettingsDto, UpdateSettingsInput } from '@stockflow/shared';
import { apiRequest } from '@/lib/api-client';
import { useApiMutation } from '@/lib/query';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) =>
      apiRequest<{ data: SettingsDto }>('/settings', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateSettings() {
  return useApiMutation(
    (input: UpdateSettingsInput) =>
      apiRequest<{ data: SettingsDto }>('/settings', { method: 'PATCH', body: input }),
    ['settings'],
  );
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Formats minor units in the workspace currency. */
export function useMoney() {
  const currency = useSettings().data?.currency ?? 'USD';
  return useCallback(
    (minor: number) => {
      let formatter = formatters.get(currency);
      if (!formatter) {
        formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
        formatters.set(currency, formatter);
      }
      return formatter.format(minor / 100);
    },
    [currency],
  );
}
