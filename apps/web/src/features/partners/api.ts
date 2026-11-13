import type { CustomerDto, EraseCustomerInput, SupplierDto } from '@stockflow/shared';
import { apiRequest, type RequestOptions } from '@/lib/api-client';
import { useApiMutation, useListQuery } from '@/lib/query';

export type PartnerKind = 'suppliers' | 'customers';
export type PartnerDtoFor<K extends PartnerKind> = K extends 'suppliers'
  ? SupplierDto
  : CustomerDto;

export const usePartners = <K extends PartnerKind>(kind: K, params: RequestOptions['query']) =>
  useListQuery<PartnerDtoFor<K>>(kind, `/${kind}`, params);

export const useSavePartner = <K extends PartnerKind>(kind: K) =>
  useApiMutation(
    ({ id, ...input }: Record<string, unknown> & { id?: string }) =>
      apiRequest<{ data: PartnerDtoFor<K> }>(id ? `/${kind}/${id}` : `/${kind}`, {
        method: id ? 'PATCH' : 'POST',
        body: input,
      }),
    [kind],
  );

export const useEraseCustomer = () =>
  useApiMutation(
    ({ id, ...input }: EraseCustomerInput & { id: string }) =>
      apiRequest<{ data: CustomerDto }>(`/customers/${id}/erase`, { method: 'POST', body: input }),
    ['customers', 'sales-orders', 'shipments'],
  );
