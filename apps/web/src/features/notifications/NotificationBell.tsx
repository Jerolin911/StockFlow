import { Link, useNavigate } from 'react-router';
import { Bell } from 'lucide-react';
import type { NotificationDto, PendingApprovalsDto } from '@stockflow/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatRelative } from './format';
import { useMarkAllRead, useMarkRead, useNotificationSummary, useNotifications } from './api';

const APPROVAL_LINKS: {
  key: keyof Omit<PendingApprovalsDto, 'total'>;
  label: string;
  to: string;
}[] = [
  {
    key: 'purchaseRequests',
    label: 'Purchase requests',
    to: '/purchase-requests?status=submitted',
  },
  {
    key: 'purchaseOrders',
    label: 'Purchase orders',
    to: '/purchase-orders?status=pending_approval',
  },
  { key: 'transfers', label: 'Transfers', to: '/stock/transfers?status=requested' },
  { key: 'customerReturns', label: 'Customer returns', to: '/customer-returns?status=requested' },
  { key: 'supplierReturns', label: 'Supplier returns', to: '/supplier-returns?status=requested' },
  { key: 'stockCounts', label: 'Stock counts to post', to: '/stock/counts?status=submitted' },
];

export function NotificationBell() {
  const navigate = useNavigate();
  const summary = useNotificationSummary();
  const latest = useNotifications({ pageSize: 8 });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const unread = summary.data?.unread ?? 0;
  const approvals = summary.data?.approvals;

  const open = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) void navigate(n.link);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell />
          {unread > 0 ? (
            <span className="bg-destructive absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        {approvals && approvals.total > 0 ? (
          <div className="border-b px-3 py-2.5">
            <p className="mb-1.5 text-xs font-medium">Waiting for your approval</p>
            <ul className="grid gap-1 text-sm">
              {APPROVAL_LINKS.filter((a) => approvals[a.key] > 0).map((a) => (
                <li key={a.key}>
                  <DropdownMenuItem asChild className="justify-between px-1.5 py-1">
                    <Link to={a.to}>
                      {a.label}
                      <span className="font-medium tabular-nums">{approvals[a.key]}</span>
                    </Link>
                  </DropdownMenuItem>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={(event) => {
                event.preventDefault();
                markAll.mutate();
              }}
            >
              Mark all as read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-96 overflow-y-auto">
          {(latest.data?.data ?? []).length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              {latest.isPending ? 'Loading…' : 'No notifications yet.'}
            </p>
          ) : (
            latest.data!.data.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="items-start gap-2 rounded-none border-b px-3 py-2.5 last:border-b-0"
                onSelect={() => open(n)}
              >
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    n.readAt ? 'bg-transparent' : 'bg-primary',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm', !n.readAt && 'font-medium')}>{n.title}</span>
                  {n.body ? (
                    <span className="text-muted-foreground block truncate text-xs">{n.body}</span>
                  ) : null}
                  <span className="text-muted-foreground block text-xs">
                    {formatRelative(n.createdAt)}
                  </span>
                </span>
                {!n.readAt ? <span className="sr-only">Unread</span> : null}
              </DropdownMenuItem>
            ))
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <DropdownMenuItem asChild className="justify-center rounded-none py-2 text-sm">
          <Link to="/notifications">View all notifications</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
