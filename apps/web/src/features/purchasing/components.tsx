import {
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  type PurchaseOrderStatus,
  type PurchaseRequestStatus,
} from '@stockflow/shared';
import { StatusBadge, type Tone } from '@/components/StatusBadge';

const PO_TONES: Record<PurchaseOrderStatus, Tone> = {
  draft: 'gray',
  pending_approval: 'amber',
  approved: 'blue',
  partially_received: 'blue',
  received: 'green',
  closed: 'gray',
  cancelled: 'red',
};

const PR_TONES: Record<PurchaseRequestStatus, Tone> = {
  draft: 'gray',
  submitted: 'amber',
  approved: 'blue',
  rejected: 'red',
  ordered: 'green',
  cancelled: 'red',
};

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <StatusBadge tone={PO_TONES[status]}>{PURCHASE_ORDER_STATUS_LABELS[status]}</StatusBadge>;
}

export function PurchaseRequestStatusBadge({ status }: { status: PurchaseRequestStatus }) {
  return (
    <StatusBadge tone={PR_TONES[status]}>{PURCHASE_REQUEST_STATUS_LABELS[status]}</StatusBadge>
  );
}
