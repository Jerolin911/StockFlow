import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '@stockflow/shared';
import { Button } from '@/components/ui/button';

export function Pagination({
  meta,
  onPageChange,
}: {
  meta: PageMeta;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  const first = (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <div className="flex items-center justify-between gap-4 border-t px-4 py-3">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {first}–{last} of {meta.total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(meta.page - 1)}
          disabled={meta.page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <span className="text-muted-foreground text-sm tabular-nums">
          {meta.page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(meta.page + 1)}
          disabled={meta.page >= pageCount}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
