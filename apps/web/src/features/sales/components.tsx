import {
  SALES_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  type SalesOrderStatus,
  type ShipmentStatus,
} from '@stockflow/shared';
import { StatusBadge, type Tone } from '@/components/StatusBadge';

const SO_TONES: Record<SalesOrderStatus, Tone> = {
  draft: 'gray',
  confirmed: 'blue',
  partially_shipped: 'amber',
  shipped: 'blue',
  delivered: 'green',
  cancelled: 'red',
};

const SHIPMENT_TONES: Record<ShipmentStatus, Tone> = {
  picking: 'amber',
  picked: 'amber',
  packed: 'blue',
  dispatched: 'blue',
  in_transit: 'blue',
  delivered: 'green',
  cancelled: 'red',
};

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  return <StatusBadge tone={SO_TONES[status]}>{SALES_ORDER_STATUS_LABELS[status]}</StatusBadge>;
}

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  return <StatusBadge tone={SHIPMENT_TONES[status]}>{SHIPMENT_STATUS_LABELS[status]}</StatusBadge>;
}

export function formatWeight(grams: number | null): string {
  if (grams === null) return '—';
  return grams >= 1000
    ? `${(grams / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`
    : `${grams} g`;
}
