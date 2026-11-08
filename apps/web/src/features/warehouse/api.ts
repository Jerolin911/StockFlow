import { useQuery } from '@tanstack/react-query';
import type {
  CreateStockCountInput,
  DispatchTransferInput,
  PostStockCountInput,
  ReceiveTransferInput,
  RecordCountsInput,
  StockCountDto,
  TransferDto,
  TransferInput,
  WarehouseOpsSummaryDto,
} from '@stockflow/shared';
import { STOCK_RESOURCES } from '@/features/catalog/api';
import { apiRequest, type RequestOptions } from '@/lib/api-client';
import { useApiMutation, useDetailQuery, useListQuery } from '@/lib/query';

type Query = RequestOptions['query'];

// Stock-moving actions refresh stock views, the ops summary and availability.
const MOVING = ['warehouse-ops', 'availability', 'quarantine', ...STOCK_RESOURCES];

export function useWarehouseOpsSummary() {
  return useQuery({
    queryKey: ['warehouse-ops', 'summary'],
    queryFn: ({ signal }) =>
      apiRequest<{ data: WarehouseOpsSummaryDto }>('/warehouse-ops/summary', { signal }).then(
        (r) => r.data,
      ),
  });
}

// Transfers

export const useTransfers = (params: Query, enabled = true) =>
  useListQuery<TransferDto>('transfers', '/stock-transfers', params, enabled);

export const useTransfer = (id: string | undefined) =>
  useDetailQuery<TransferDto>('transfers', `/stock-transfers/${id}`, id);

export const useSaveTransfer = () =>
  useApiMutation(
    ({ id, ...input }: TransferInput & { id?: string }) =>
      apiRequest<{ data: TransferDto }>(id ? `/stock-transfers/${id}` : '/stock-transfers', {
        method: id ? 'PATCH' : 'POST',
        body: input,
      }),
    ['transfers', 'warehouse-ops'],
  );

export type TransferAction =
  | { action: 'approve' }
  | { action: 'reject' | 'cancel' | 'close'; body: { reason: string } }
  | { action: 'dispatch'; body: DispatchTransferInput }
  | { action: 'receive'; body: ReceiveTransferInput };

export const useTransferAction = () =>
  useApiMutation(
    ({ id, ...rest }: TransferAction & { id: string }) =>
      apiRequest<{ data: TransferDto }>(`/stock-transfers/${id}/${rest.action}`, {
        method: 'POST',
        body: 'body' in rest ? rest.body : {},
      }),
    ['transfers', ...MOVING],
  );

// Counts

export const useStockCounts = (params: Query) =>
  useListQuery<StockCountDto>('stock-counts', '/stock-counts', params);

export const useStockCount = (id: string | undefined) =>
  useDetailQuery<StockCountDto>('stock-counts', `/stock-counts/${id}`, id);

export const useCreateStockCount = () =>
  useApiMutation(
    (input: CreateStockCountInput) =>
      apiRequest<{ data: StockCountDto }>('/stock-counts', { method: 'POST', body: input }),
    ['stock-counts', 'warehouse-ops'],
  );

export const useRecordCounts = () =>
  useApiMutation(
    ({ id, ...input }: RecordCountsInput & { id: string }) =>
      apiRequest<{ data: StockCountDto }>(`/stock-counts/${id}/counts`, {
        method: 'PUT',
        body: input,
      }),
    ['stock-counts'],
  );

export type StockCountAction =
  | { action: 'submit' | 'reopen' }
  | { action: 'cancel'; body: { reason: string } }
  | { action: 'post'; body: PostStockCountInput };

export const useStockCountAction = () =>
  useApiMutation(
    ({ id, ...rest }: StockCountAction & { id: string }) =>
      apiRequest<{ data: StockCountDto }>(`/stock-counts/${id}/${rest.action}`, {
        method: 'POST',
        body: 'body' in rest ? rest.body : {},
      }),
    ['stock-counts', ...MOVING],
  );
