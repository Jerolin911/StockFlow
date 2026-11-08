import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateUserInput,
  ListUsersQuery,
  Paginated,
  ResetPasswordInput,
  UpdateUserInput,
  UserDto,
  UserStatsDto,
} from '@stockflow/shared';
import { apiRequest } from '@/lib/api-client';

export const userKeys = {
  all: ['users'] as const,
  list: (params: Partial<ListUsersQuery>) => ['users', 'list', params] as const,
  stats: ['users', 'stats'] as const,
};

export function useUsers(params: Partial<ListUsersQuery>) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: ({ signal }) => apiRequest<Paginated<UserDto>>('/users', { query: params, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useUserStats(enabled = true) {
  return useQuery({
    queryKey: userKeys.stats,
    queryFn: ({ signal }) =>
      apiRequest<{ data: UserStatsDto }>('/users/stats', { signal }).then((r) => r.data),
    enabled,
  });
}

function useUserMutation<TInput>(request: (input: TInput) => Promise<{ data: UserDto }>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TInput) => (await request(input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useCreateUser() {
  return useUserMutation((input: CreateUserInput) =>
    apiRequest('/users', { method: 'POST', body: input }),
  );
}

export function useUpdateUser() {
  return useUserMutation(({ id, ...input }: UpdateUserInput & { id: string }) =>
    apiRequest(`/users/${id}`, { method: 'PATCH', body: input }),
  );
}

export function useResetPassword() {
  return useUserMutation(({ id, ...input }: ResetPasswordInput & { id: string }) =>
    apiRequest(`/users/${id}/reset-password`, { method: 'POST', body: input }),
  );
}
