import { useQuery } from '@tanstack/react-query';
import type {
  GoodsReceiptDto,
  GoodsReceiptInput,
  ProductSupplierPriceDto,
  PurchaseOrderDto,
  PurchaseOrderInput,
  PurchaseRequestDto,
  PurchaseRequestInput,
  SupplierDeliverySummaryDto,
  SupplierPriceDto,
  SupplierPriceInput,
} from '@stockflow/shared';
import { STOCK_RESOURCES } from '@/features/catalog/api';
import { apiRequest, type RequestOptions } from '@/lib/api-client';
import { useApiMutation, useDetailQuery, useListQuery } from '@/lib/query';

type Query = RequestOptions['query'];

// Purchase requests

export const usePurchaseRequests = (params: Query) =>
  useListQuery<PurchaseRequestDto>('purchase-requests', '/purchase-requests', params);

export const usePurchaseRequest = (id: string | undefined) =>
  useDetailQuery<PurchaseRequestDto>('purchase-requests', `/purchase-requests/${id}`, id);

export const useSavePurchaseRequest = () =>
  useApiMutation(
    ({ id, ...input }: PurchaseRequestInput & { id?: string }) =>
      apiRequest<{ data: PurchaseRequestDto }>(
        id ? `/purchase-requests/${id}` : '/purchase-requests',
        {
          method: id ? 'PATCH' : 'POST',
          body: input,
        },
      ),
    ['purchase-requests'],
  );

export const usePurchaseRequestAction = () =>
  useApiMutation(
    ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'submit' | 'approve' | 'reject' | 'cancel';
      reason?: string;
    }) =>
      apiRequest<{ data: PurchaseRequestDto }>(`/purchase-requests/${id}/${action}`, {
        method: 'POST',
        body: reason ? { reason } : {},
      }),
    ['purchase-requests'],
  );

export const useDeletePurchaseRequest = () =>
  useApiMutation(
    async (id: string) => {
      await apiRequest(`/purchase-requests/${id}`, { method: 'DELETE' });
      return { data: null };
    },
    ['purchase-requests'],
  );

export const useConvertPurchaseRequest = () =>
  useApiMutation(
    ({ id, supplierId }: { id: string; supplierId: string }) =>
      apiRequest<{ data: { purchaseOrderId: string } }>(`/purchase-requests/${id}/convert`, {
        method: 'POST',
        body: { supplierId },
      }),
    ['purchase-requests', 'purchase-orders'],
  );

// Purchase orders

export const usePurchaseOrders = (params: Query, enabled = true) =>
  useListQuery<PurchaseOrderDto>('purchase-orders', '/purchase-orders', params, enabled);

export const usePurchaseOrder = (id: string | undefined) =>
  useDetailQuery<PurchaseOrderDto>('purchase-orders', `/purchase-orders/${id}`, id);

export const useSavePurchaseOrder = () =>
  useApiMutation(
    ({ id, ...input }: PurchaseOrderInput & { id?: string }) =>
      apiRequest<{ data: PurchaseOrderDto }>(id ? `/purchase-orders/${id}` : '/purchase-orders', {
        method: id ? 'PATCH' : 'POST',
        body: input,
      }),
    ['purchase-orders'],
  );

export type PurchaseOrderAction = 'submit' | 'approve' | 'reject' | 'cancel' | 'close';

export const usePurchaseOrderAction = () =>
  useApiMutation(
    ({ id, action, reason }: { id: string; action: PurchaseOrderAction; reason?: string }) =>
      apiRequest<{ data: PurchaseOrderDto }>(`/purchase-orders/${id}/${action}`, {
        method: 'POST',
        body: reason ? { reason } : {},
      }),
    ['purchase-orders', 'purchase-requests', 'suppliers'],
  );

export const useDeletePurchaseOrder = () =>
  useApiMutation(
    async (id: string) => {
      await apiRequest(`/purchase-orders/${id}`, { method: 'DELETE' });
      return { data: null };
    },
    ['purchase-orders', 'purchase-requests'],
  );

// Goods receipts

export const useGoodsReceipts = (params: Query, enabled = true) =>
  useListQuery<GoodsReceiptDto>('goods-receipts', '/goods-receipts', params, enabled);

export const useGoodsReceipt = (id: string | undefined) =>
  useDetailQuery<GoodsReceiptDto>('goods-receipts', `/goods-receipts/${id}`, id);

export const usePostGoodsReceipt = () =>
  useApiMutation(
    (input: GoodsReceiptInput) =>
      apiRequest<{ data: GoodsReceiptDto }>('/goods-receipts', { method: 'POST', body: input }),
    ['goods-receipts', 'purchase-orders', 'supplier-summary', ...STOCK_RESOURCES],
  );

// Supplier prices and delivery history

export function useSupplierPrices(supplierId: string | undefined) {
  return useQuery({
    queryKey: ['supplier-prices', supplierId],
    queryFn: ({ signal }) =>
      apiRequest<{ data: SupplierPriceDto[] }>(`/suppliers/${supplierId}/prices`, { signal }).then(
        (r) => r.data,
      ),
    enabled: Boolean(supplierId),
  });
}

export function useProductSupplierPrices(productId: string | undefined) {
  return useQuery({
    queryKey: ['supplier-prices', 'product', productId],
    queryFn: ({ signal }) =>
      apiRequest<{ data: ProductSupplierPriceDto[] }>(`/products/${productId}/supplier-prices`, {
        signal,
      }).then((r) => r.data),
    enabled: Boolean(productId),
  });
}

export const useSaveSupplierPrice = () =>
  useApiMutation(
    ({
      supplierId,
      productId,
      ...input
    }: SupplierPriceInput & { supplierId: string; productId: string }) =>
      apiRequest<{ data: SupplierPriceDto }>(`/suppliers/${supplierId}/prices/${productId}`, {
        method: 'PUT',
        body: input,
      }),
    ['supplier-prices'],
  );

export const useDeleteSupplierPrice = () =>
  useApiMutation(
    async ({ supplierId, productId }: { supplierId: string; productId: string }) => {
      await apiRequest(`/suppliers/${supplierId}/prices/${productId}`, { method: 'DELETE' });
      return { data: null };
    },
    ['supplier-prices'],
  );

export function useSupplierDeliverySummary(supplierId: string | undefined) {
  return useQuery({
    queryKey: ['supplier-summary', supplierId],
    queryFn: ({ signal }) =>
      apiRequest<{ data: SupplierDeliverySummaryDto }>(
        `/suppliers/${supplierId}/delivery-summary`,
        {
          signal,
        },
      ).then((r) => r.data),
    enabled: Boolean(supplierId),
  });
}
