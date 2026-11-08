import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" className="fill-primary" />
        <path
          d="M9 11.5 16 8l7 3.5v9L16 24l-7-3.5zM9 11.5 16 15l7-3.5M16 15v9"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      StockFlow
    </span>
  );
}
