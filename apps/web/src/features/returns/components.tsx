import {
  CUSTOMER_RETURN_STATUS_LABELS,
  SUPPLIER_RETURN_STATUS_LABELS,
  type CustomerReturnStatus,
  type SupplierReturnStatus,
} from '@stockflow/shared';
import { StatusBadge, type Tone } from '@/components/StatusBadge';

const CUSTOMER_TONES: Record<CustomerReturnStatus, Tone> = {
  requested: 'amber',
  approved: 'blue',
  received: 'amber',
  completed: 'green',
  rejected: 'red',
  cancelled: 'red',
};

const SUPPLIER_TONES: Record<SupplierReturnStatus, Tone> = {
  requested: 'amber',
  approved: 'blue',
  dispatched: 'green',
  rejected: 'red',
  cancelled: 'red',
};

export function CustomerReturnStatusBadge({ status }: { status: CustomerReturnStatus }) {
  return (
    <StatusBadge tone={CUSTOMER_TONES[status]}>{CUSTOMER_RETURN_STATUS_LABELS[status]}</StatusBadge>
  );
}

export function SupplierReturnStatusBadge({ status }: { status: SupplierReturnStatus }) {
  return (
    <StatusBadge tone={SUPPLIER_TONES[status]}>{SUPPLIER_RETURN_STATUS_LABELS[status]}</StatusBadge>
  );
}
