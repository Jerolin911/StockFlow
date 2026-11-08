import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { Paginated } from '@stockflow/shared';
import { apiRequest, type RequestOptions } from './api-client';

type Query = RequestOptions['query'];

export function useListQuery<T>(resource: string, path: string, params: Query, enabled = true) {
  return useQuery({
    queryKey: [resource, 'list', params] satisfies QueryKey,
    queryFn: ({ signal }) => apiRequest<Paginated<T>>(path, { query: params, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDetailQuery<T>(resource: string, path: string, id: string | undefined) {
  return useQuery({
    queryKey: [resource, 'detail', id] satisfies QueryKey,
    queryFn: ({ signal }) => apiRequest<{ data: T }>(path, { signal }).then((r) => r.data),
    enabled: Boolean(id),
  });
}

/** Mutation that unwraps `{ data }` and invalidates the given resources on success. */
export function useApiMutation<TInput, TResult>(
  request: (input: TInput) => Promise<{ data: TResult }>,
  invalidate: string[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TInput) => (await request(input)).data,
    onSuccess: () =>
      Promise.all(invalidate.map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
  });
}
