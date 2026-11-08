import { STOCK_DOCUMENT_TYPE_LABELS, type StockDocumentType } from '@stockflow/shared';
import { StatusBadge, type Tone } from '@/components/StatusBadge';

const TONES: Record<StockDocumentType, Tone> = {
  opening: 'blue',
  adjustment: 'gray',
  quarantine: 'amber',
  release: 'green',
  write_off: 'red',
};

export function StockDocumentBadge({ type }: { type: StockDocumentType }) {
  return <StatusBadge tone={TONES[type]}>{STOCK_DOCUMENT_TYPE_LABELS[type]}</StatusBadge>;
}
