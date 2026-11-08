import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS, ROLES, type Role, type UserDto } from '@stockflow/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCurrentUser } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useUpdateUser, useUsers } from './api';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { UserFormDialog } from './UserFormDialog';

const PAGE_SIZE = 20;
const ALL = 'all';

function useUserFilters() {
  const [params, setParams] = useSearchParams();
  const roleParam = params.get('role');
  const statusParam = params.get('status');
  const filters = {
    search: params.get('search') ?? '',
    role: ROLES.includes(roleParam as Role) ? (roleParam as Role) : undefined,
    status:
      statusParam === 'active' || statusParam === 'inactive'
        ? (statusParam as 'active' | 'inactive')
        : undefined,
    page: Math.max(1, Number(params.get('page')) || 1),
  };

  const update = (
    changes: Partial<Record<'search' | 'role' | 'status' | 'page', string | undefined>>,
  ) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  return { filters, update };
}

export function UsersPage() {
  const { user: currentUser } = useCurrentUser();
  const { filters, update } = useUserFilters();
  const [searchInput, setSearchInput] = useState(filters.search);
  const [formUser, setFormUser] = useState<UserDto | null | undefined>(undefined);
  const [resetUser, setResetUser] = useState<UserDto | null>(null);
  const [statusUser, setStatusUser] = useState<UserDto | null>(null);
  const updateUser = useUpdateUser();

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => update({ search: value.trim() || undefined }), 300);
  };

  const users = useUsers({
    page: filters.page,
    pageSize: PAGE_SIZE,
    sort: 'name',
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  });

  const toggleStatus = async () => {
    if (!statusUser) return;
    const activating = !statusUser.isActive;
    try {
      await updateUser.mutateAsync({ id: statusUser.id, isActive: activating });
      toast.success(`${statusUser.name} ${activating ? 'reactivated' : 'deactivated'}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not update the user');
    }
  };

  const hasFilters = Boolean(filters.search || filters.role || filters.status);

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage who can sign in and what each person can do."
        actions={
          <Button onClick={() => setFormUser(null)}>
            <Plus />
            Add user
          </Button>
        }
      />

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search name or email"
              aria-label="Search users"
              className="pl-8"
            />
          </div>
          <Select
            value={filters.role ?? ALL}
            onValueChange={(v) => update({ role: v === ALL ? undefined : v })}
          >
            <SelectTrigger className="w-44" aria-label="Filter by role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {ROLE_LABELS[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.status ?? ALL}
            onValueChange={(v) => update({ status: v === ALL ? undefined : v })}
          >
            <SelectTrigger className="w-36" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Deactivated</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearTimeout(searchTimer.current);
                setSearchInput('');
                update({ search: undefined, role: undefined, status: undefined });
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
              <TableHead className="w-12 pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isPending ? (
              Array.from({ length: 5 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5} className="px-4">
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : users.isError ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center">
                  <p className="text-destructive text-sm">Couldn't load users.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => void users.refetch()}
                  >
                    Try again
                  </Button>
                </TableCell>
              </TableRow>
            ) : users.data.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-10 text-center text-sm">
                  {hasFilters ? 'No users match these filters.' : 'No users yet.'}
                </TableCell>
              </TableRow>
            ) : (
              users.data.data.map((user) => {
                const isSelf = user.id === currentUser.id;
                return (
                  <TableRow
                    key={user.id}
                    className={user.isActive ? undefined : 'text-muted-foreground'}
                  >
                    <TableCell className="pl-4">
                      <div className="font-medium">
                        {user.name}
                        {isSelf ? (
                          <span className="text-muted-foreground ml-2 text-xs font-normal">
                            (you)
                          </span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground text-xs">{user.email}</div>
                    </TableCell>
                    <TableCell>{ROLE_LABELS[user.role]}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {user.isActive ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Deactivated
                          </Badge>
                        )}
                        {user.mustChangePassword && user.isActive ? (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-800"
                          >
                            Password change pending
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatDateTime(user.lastLoginAt, 'Never')}
                    </TableCell>
                    <TableCell className="pr-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${user.name}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setFormUser(user)}>
                            Edit
                          </DropdownMenuItem>
                          {isSelf ? null : (
                            <>
                              <DropdownMenuItem onSelect={() => setResetUser(user)}>
                                Reset password
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant={user.isActive ? 'destructive' : 'default'}
                                onSelect={() => setStatusUser(user)}
                              >
                                {user.isActive ? 'Deactivate' : 'Reactivate'}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {users.data && users.data.meta.total > 0 ? (
          <Pagination
            meta={users.data.meta}
            onPageChange={(page) => update({ page: String(page) })}
          />
        ) : null}
      </Card>

      <UserFormDialog
        open={formUser !== undefined}
        onOpenChange={(open) => !open && setFormUser(undefined)}
        user={formUser ?? null}
        currentUserId={currentUser.id}
      />
      <ResetPasswordDialog user={resetUser} onOpenChange={(open) => !open && setResetUser(null)} />
      <ConfirmDialog
        open={statusUser !== null}
        onOpenChange={(open) => !open && setStatusUser(null)}
        title={statusUser?.isActive ? 'Deactivate user' : 'Reactivate user'}
        description={
          statusUser?.isActive
            ? `${statusUser.name} will be signed out immediately and won't be able to sign in.`
            : `${statusUser?.name ?? ''} will be able to sign in again.`
        }
        confirmLabel={statusUser?.isActive ? 'Deactivate' : 'Reactivate'}
        destructive={statusUser?.isActive ?? false}
        onConfirm={toggleStatus}
      />
    </>
  );
}
