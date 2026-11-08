import { useQuery } from '@tanstack/react-query';
import type {
  CategoryDto,
  CreateCategoryInput,
  CreateProductInput,
  CreateWarehouseInput,
  Paginated,
  ProductDto,
  UpdateCategoryInput,
  UpdateProductInput,
  UpdateWarehouseInput,
  WarehouseDto,
} from '@stockflow/shared';
import { apiRequest, type RequestOptions } from '@/lib/api-client';
import { useApiMutation, useDetailQuery, useListQuery } from '@/lib/query';

type Query = RequestOptions['query'];

// Stock figures shown with products and warehouses change whenever stock moves.
const STOCK_RESOURCES = ['products', 'warehouses', 'stock-levels', 'movements', 'adjustments'];

export const useWarehouses = (params: Query) =>
  useListQuery<WarehouseDto>('warehouses', '/warehouses', params);

/** Every warehouse, for pickers and filters. */
export function useWarehouseOptions(includeInactive = false) {
  return useQuery({
    queryKey: ['warehouses', 'options', includeInactive],
    queryFn: ({ signal }) =>
      apiRequest<Paginated<WarehouseDto>>('/warehouses', {
        query: { pageSize: 100, ...(includeInactive ? {} : { status: 'active' }) },
        signal,
      }).then((r) => r.data),
    staleTime: 60_000,
  });
}

export const useCreateWarehouse = () =>
  useApiMutation(
    (input: CreateWarehouseInput) =>
      apiRequest<{ data: WarehouseDto }>('/warehouses', { method: 'POST', body: input }),
    ['warehouses'],
  );

export const useUpdateWarehouse = () =>
  useApiMutation(
    ({ id, ...input }: UpdateWarehouseInput & { id: string }) =>
      apiRequest<{ data: WarehouseDto }>(`/warehouses/${id}`, { method: 'PATCH', body: input }),
    ['warehouses', 'stock-levels'],
  );

export const useCategories = (params: Query) =>
  useListQuery<CategoryDto>('categories', '/categories', params);

export function useCategoryOptions() {
  return useQuery({
    queryKey: ['categories', 'options'],
    queryFn: ({ signal }) =>
      apiRequest<Paginated<CategoryDto>>('/categories', { query: { pageSize: 200 }, signal }).then(
        (r) => r.data,
      ),
    staleTime: 60_000,
  });
}

export const useCreateCategory = () =>
  useApiMutation(
    (input: CreateCategoryInput) =>
      apiRequest<{ data: CategoryDto }>('/categories', { method: 'POST', body: input }),
    ['categories'],
  );

export const useUpdateCategory = () =>
  useApiMutation(
    ({ id, ...input }: UpdateCategoryInput & { id: string }) =>
      apiRequest<{ data: CategoryDto }>(`/categories/${id}`, { method: 'PATCH', body: input }),
    ['categories', 'products'],
  );

export const useDeleteCategory = () =>
  useApiMutation(
    async (id: string) => {
      await apiRequest(`/categories/${id}`, { method: 'DELETE' });
      return { data: null };
    },
    ['categories'],
  );

export const useProducts = (params: Query) =>
  useListQuery<ProductDto>('products', '/products', params);

export const useProduct = (id: string | undefined) =>
  useDetailQuery<ProductDto>('products', `/products/${id}`, id);

export const useCreateProduct = () =>
  useApiMutation(
    (input: CreateProductInput) =>
      apiRequest<{ data: ProductDto }>('/products', { method: 'POST', body: input }),
    ['products', 'categories'],
  );

export const useUpdateProduct = () =>
  useApiMutation(
    ({ id, ...input }: UpdateProductInput & { id: string }) =>
      apiRequest<{ data: ProductDto }>(`/products/${id}`, { method: 'PATCH', body: input }),
    ['products', 'categories', 'stock-levels'],
  );

export { STOCK_RESOURCES };
