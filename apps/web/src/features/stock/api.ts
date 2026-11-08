import type {
  OpeningStockInput,
  StockAdjustmentDto,
  StockAdjustmentInput,
  StockLevelDto,
  StockMovementDto,
} from '@stockflow/shared';
import { STOCK_RESOURCES } from '@/features/catalog/api';
import { apiRequest, type RequestOptions } from '@/lib/api-client';
import { useApiMutation, useDetailQuery, useListQuery } from '@/lib/query';

type Query = RequestOptions['query'];

export const useStockLevels = (params: Query, enabled = true) =>
  useListQuery<StockLevelDto>('stock-levels', '/stock/levels', params, enabled);

export const useMovements = (params: Query) =>
  useListQuery<StockMovementDto>('movements', '/stock/movements', params);

export const useAdjustments = (params: Query) =>
  useListQuery<StockAdjustmentDto>('adjustments', '/stock/adjustments', params);

export const useAdjustment = (id: string | undefined) =>
  useDetailQuery<StockAdjustmentDto>('adjustments', `/stock/adjustments/${id}`, id);

export const usePostAdjustment = () =>
  useApiMutation(
    (input: StockAdjustmentInput) =>
      apiRequest<{ data: StockAdjustmentDto }>('/stock/adjustments', {
        method: 'POST',
        body: input,
      }),
    STOCK_RESOURCES,
  );

export const useRegisterOpeningStock = () =>
  useApiMutation(
    (input: OpeningStockInput) =>
      apiRequest<{ data: StockAdjustmentDto }>('/stock/opening', { method: 'POST', body: input }),
    STOCK_RESOURCES,
  );

export const useUpdateThreshold = () =>
  useApiMutation(
    ({ id, reorderPoint }: { id: string; reorderPoint: number | null }) =>
      apiRequest<{ data: StockLevelDto }>(`/stock/levels/${id}`, {
        method: 'PATCH',
        body: { reorderPoint },
      }),
    ['stock-levels', 'products'],
  );
