import { useQuery } from '@tanstack/react-query';
import type {
  ConfirmPickInput,
  CreateShipmentInput,
  DispatchShipmentInput,
  FulfilmentSummaryDto,
  PackShipmentInput,
  ProductAvailabilityDto,
  SalesOrderDto,
  SalesOrderInput,
  ShipmentDto,
  TrackingEventInput,
} from '@stockflow/shared';
import { STOCK_RESOURCES } from '@/features/catalog/api';
import { apiRequest, type RequestOptions } from '@/lib/api-client';
import { useApiMutation, useDetailQuery, useListQuery } from '@/lib/query';

type Query = RequestOptions['query'];

// Reservations and shipments change stock figures everywhere they're shown.
const FULFILMENT_RESOURCES = [
  'sales-orders',
  'shipments',
  'availability',
  'fulfilment-summary',
  ...STOCK_RESOURCES,
];

// Sales orders

export const useSalesOrders = (params: Query, enabled = true) =>
  useListQuery<SalesOrderDto>('sales-orders', '/sales-orders', params, enabled);

export const useSalesOrder = (id: string | undefined) =>
  useDetailQuery<SalesOrderDto>('sales-orders', `/sales-orders/${id}`, id);

export const useSaveSalesOrder = () =>
  useApiMutation(
    ({ id, ...input }: SalesOrderInput & { id?: string }) =>
      apiRequest<{ data: SalesOrderDto }>(id ? `/sales-orders/${id}` : '/sales-orders', {
        method: id ? 'PATCH' : 'POST',
        body: input,
      }),
    ['sales-orders', 'fulfilment-summary'],
  );

export const useSalesOrderAction = () =>
  useApiMutation(
    ({ id, action, reason }: { id: string; action: 'confirm' | 'cancel'; reason?: string }) =>
      apiRequest<{ data: SalesOrderDto }>(`/sales-orders/${id}/${action}`, {
        method: 'POST',
        body: reason ? { reason } : {},
      }),
    FULFILMENT_RESOURCES,
  );

export const useDeleteSalesOrder = () =>
  useApiMutation(
    async (id: string) => {
      await apiRequest(`/sales-orders/${id}`, { method: 'DELETE' });
      return { data: null };
    },
    ['sales-orders', 'fulfilment-summary'],
  );

export function useFulfilmentSummary() {
  return useQuery({
    queryKey: ['fulfilment-summary'],
    queryFn: ({ signal }) =>
      apiRequest<{ data: FulfilmentSummaryDto }>('/sales-orders/fulfilment-summary', {
        signal,
      }).then((r) => r.data),
  });
}

/** Stock per warehouse for the given products, for availability checks while ordering. */
export function useAvailability(productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ['availability', ids],
    queryFn: ({ signal }) =>
      apiRequest<{ data: ProductAvailabilityDto[] }>('/stock/availability', {
        query: { productIds: ids.join(',') },
        signal,
      }).then((r) => new Map(r.data.map((p) => [p.productId, p.warehouses]))),
    enabled: ids.length > 0,
    placeholderData: (previous) => previous,
  });
}

// Shipments

export const useShipments = (params: Query, enabled = true) =>
  useListQuery<ShipmentDto>('shipments', '/shipments', params, enabled);

export const useShipment = (id: string | undefined) =>
  useDetailQuery<ShipmentDto>('shipments', `/shipments/${id}`, id);

export const useCreateShipment = () =>
  useApiMutation(
    (input: CreateShipmentInput) =>
      apiRequest<{ data: ShipmentDto }>('/shipments', { method: 'POST', body: input }),
    FULFILMENT_RESOURCES,
  );

export type ShipmentStep =
  | { step: 'pick'; body: ConfirmPickInput }
  | { step: 'pack'; body: PackShipmentInput }
  | { step: 'dispatch'; body: DispatchShipmentInput }
  | { step: 'tracking'; body: TrackingEventInput }
  | { step: 'cancel'; body: { reason: string } };

export const useShipmentStep = () =>
  useApiMutation(
    ({ id, step, body }: ShipmentStep & { id: string }) =>
      apiRequest<{ data: ShipmentDto }>(`/shipments/${id}/${step}`, { method: 'POST', body }),
    FULFILMENT_RESOURCES,
  );
