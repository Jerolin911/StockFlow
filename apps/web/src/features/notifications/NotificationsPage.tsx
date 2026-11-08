import { Link } from 'react-router';
import { CheckCheck } from 'lucide-react';
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS } from '@stockflow/shared';
import { FilterSelect } from '@/components/filters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { StatusBadge } from '@/components/StatusBadge';
import { FilterBar } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { cn } from '@/lib/utils';
import { useMarkAllRead, useMarkRead, useNotificationSummary, useNotifications } from './api';

export function NotificationsPage() {
  const filters = useUrlFilters(['type', 'unread'] as const);
  const list = useNotifications({ ...compact(filters.values), page: filters.page, pageSize: 25 });
  const summary = useNotificationSummary();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const rows = list.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates on orders, receipts, shipments, transfers, returns and stock levels that concern you."
        actions={
          (summary.data?.unread ?? 0) > 0 ? (
            <Button variant="outline" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              <CheckCheck />
              Mark all as read
            </Button>
          ) : null
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <FilterSelect
            label="Filter by type"
            value={filters.values.type}
            onChange={(type) => filters.update({ type })}
            allLabel="All types"
            options={NOTIFICATION_TYPES.map((t) => ({
              value: t,
              label: NOTIFICATION_TYPE_LABELS[t],
            }))}
          />
          <FilterSelect
            label="Filter by read state"
            value={filters.values.unread}
            onChange={(unread) => filters.update({ unread })}
            allLabel="Read and unread"
            options={[{ value: 'true', label: 'Unread only' }]}
          />
        </FilterBar>
        {list.isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">
            {filters.active ? 'No notifications match these filters.' : 'No notifications yet.'}
          </p>
        ) : (
          <ul>
            {rows.map((n) => (
              <li
                key={n.id}
                className={cn(
                  'flex items-start gap-3 border-t px-4 py-3 first:border-t-0',
                  !n.readAt && 'bg-primary/5',
                )}
              >
                <span
                  className={cn(
                    'mt-2 size-2 shrink-0 rounded-full',
                    n.readAt ? 'bg-transparent' : 'bg-primary',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.link ? (
                      <Link
                        to={n.link}
                        className={cn('text-sm hover:underline', !n.readAt && 'font-medium')}
                        onClick={() => !n.readAt && markRead.mutate(n.id)}
                      >
                        {n.title}
                      </Link>
                    ) : (
                      <span className={cn('text-sm', !n.readAt && 'font-medium')}>{n.title}</span>
                    )}
                    <StatusBadge tone={n.type === 'low_stock' ? 'amber' : 'gray'}>
                      {NOTIFICATION_TYPE_LABELS[n.type]}
                    </StatusBadge>
                  </div>
                  {n.body ? <p className="text-muted-foreground mt-0.5 text-sm">{n.body}</p> : null}
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {formatDateTime(n.createdAt)}
                  </p>
                </div>
                {!n.readAt ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markRead.mutate(n.id)}
                    aria-label={`Mark "${n.title}" as read`}
                  >
                    Mark read
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {list.data && list.data.meta.total > 0 ? (
          <Pagination
            meta={list.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
