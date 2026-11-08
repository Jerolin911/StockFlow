import type {
  CustomerReturnDto,
  CustomerReturnInput,
  DispatchSupplierReturnInput,
  InspectCustomerReturnInput,
  ReceiveCustomerReturnInput,
  SupplierReturnDto,
  SupplierReturnInput,
} from '@stockflow/shared';
import { STOCK_RESOURCES } from '@/features/catalog/api';
import { apiRequest, type RequestOptions } from '@/lib/api-client';
import { useApiMutation, useDetailQuery, useListQuery } from '@/lib/query';

type Query = RequestOptions['query'];

const MOVING = ['warehouse-ops', 'availability', 'quarantine', ...STOCK_RESOURCES];

// Customer returns

export const useCustomerReturns = (params: Query, enabled = true) =>
  useListQuery<CustomerReturnDto>('customer-returns', '/customer-returns', params, enabled);

export const useCustomerReturn = (id: string | undefined) =>
  useDetailQuery<CustomerReturnDto>('customer-returns', `/customer-returns/${id}`, id);

export const useCreateCustomerReturn = () =>
  useApiMutation(
    (input: CustomerReturnInput) =>
      apiRequest<{ data: CustomerReturnDto }>('/customer-returns', { method: 'POST', body: input }),
    ['customer-returns', 'sales-orders', 'warehouse-ops'],
  );

export type CustomerReturnAction =
  | { action: 'approve' }
  | { action: 'reject' | 'cancel'; body: { reason: string } }
  | { action: 'receive'; body: ReceiveCustomerReturnInput }
  | { action: 'inspect'; body: InspectCustomerReturnInput };

export const useCustomerReturnAction = () =>
  useApiMutation(
    ({ id, ...rest }: CustomerReturnAction & { id: string }) =>
      apiRequest<{ data: CustomerReturnDto }>(`/customer-returns/${id}/${rest.action}`, {
        method: 'POST',
        body: 'body' in rest ? rest.body : {},
      }),
    ['customer-returns', 'sales-orders', ...MOVING],
  );

// Supplier returns

export const useSupplierReturns = (params: Query) =>
  useListQuery<SupplierReturnDto>('supplier-returns', '/supplier-returns', params);

export const useSupplierReturn = (id: string | undefined) =>
  useDetailQuery<SupplierReturnDto>('supplier-returns', `/supplier-returns/${id}`, id);

export const useCreateSupplierReturn = () =>
  useApiMutation(
    (input: SupplierReturnInput) =>
      apiRequest<{ data: SupplierReturnDto }>('/supplier-returns', { method: 'POST', body: input }),
    ['supplier-returns', 'warehouse-ops'],
  );

export type SupplierReturnAction =
  | { action: 'approve' }
  | { action: 'reject' | 'cancel'; body: { reason: string } }
  | { action: 'dispatch'; body: DispatchSupplierReturnInput };

export const useSupplierReturnAction = () =>
  useApiMutation(
    ({ id, ...rest }: SupplierReturnAction & { id: string }) =>
      apiRequest<{ data: SupplierReturnDto }>(`/supplier-returns/${id}/${rest.action}`, {
        method: 'POST',
        body: 'body' in rest ? rest.body : {},
      }),
    ['supplier-returns', ...MOVING],
  );
