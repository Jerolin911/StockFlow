import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';

interface TableStateProps {
  colSpan: number;
  isPending: boolean;
  isError: boolean;
  isEmpty: boolean;
  onRetry: () => void;
  emptyMessage: ReactNode;
  children: ReactNode;
}

/** Renders loading, error and empty rows, or the given rows. */
export function TableBodyState({
  colSpan,
  isPending,
  isError,
  isEmpty,
  onRetry,
  emptyMessage,
  children,
}: TableStateProps) {
  if (isPending) {
    return Array.from({ length: 5 }, (_, i) => (
      <TableRow key={i}>
        <TableCell colSpan={colSpan} className="px-4">
          <Skeleton className="h-8 w-full" />
        </TableCell>
      </TableRow>
    ));
  }
  if (isError) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-10 text-center">
          <p className="text-destructive text-sm">Couldn't load this list.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </TableCell>
      </TableRow>
    );
  }
  if (isEmpty) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="text-muted-foreground py-10 text-center text-sm">
          {emptyMessage}
        </TableCell>
      </TableRow>
    );
  }
  return children;
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 border-b p-4">{children}</div>;
}
