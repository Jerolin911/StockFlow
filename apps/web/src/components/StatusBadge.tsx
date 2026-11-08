import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const TONES = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-red-200 bg-red-50 text-red-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  gray: 'text-muted-foreground',
} as const;

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: keyof typeof TONES;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(TONES[tone], className)}>
      {children}
    </Badge>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <StatusBadge tone="green">Active</StatusBadge>
  ) : (
    <StatusBadge tone="gray">Inactive</StatusBadge>
  );
}

/** Stock state for a quantity against a threshold. */
export function StockBadge({ available, isLow }: { available: number; isLow: boolean }) {
  if (available <= 0) return <StatusBadge tone="red">Out of stock</StatusBadge>;
  if (isLow) return <StatusBadge tone="amber">Low stock</StatusBadge>;
  return null;
}
