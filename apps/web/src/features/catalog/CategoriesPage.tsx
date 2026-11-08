import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  createCategorySchema,
  type CategoryDto,
  type CreateCategoryInput,
} from '@stockflow/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchInput } from '@/components/filters';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { FilterBar, TableBodyState } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermission } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api-client';
import { applyServerErrors } from '@/lib/forms';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useCategories, useCreateCategory, useDeleteCategory, useUpdateCategory } from './api';

export function CategoriesPage() {
  const canManage = usePermission('categories:manage');
  const filters = useUrlFilters(['search'] as const);
  const [editing, setEditing] = useState<CategoryDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<CategoryDto | null>(null);
  const categories = useCategories({
    ...compact(filters.values),
    page: filters.page,
    pageSize: 25,
  });
  const deleteCategory = useDeleteCategory();
  const rows = categories.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Categories"
        description="Group products. The category code prefixes generated SKUs."
        actions={
          canManage ? (
            <Button onClick={() => setEditing(null)}>
              <Plus />
              Add category
            </Button>
          ) : null
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <SearchInput
            value={filters.values.search}
            onChange={(search) => filters.update({ search })}
            placeholder="Search name or code"
            label="Search categories"
          />
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="hidden md:table-cell">Description</TableHead>
              <TableHead className="text-right">Products</TableHead>
              {canManage ? <TableHead className="w-12 pr-4" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={canManage ? 5 : 4}
              isPending={categories.isPending}
              isError={categories.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void categories.refetch()}
              emptyMessage={
                filters.active ? 'No categories match your search.' : 'No categories yet.'
              }
            >
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4 font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell className="text-muted-foreground hidden max-w-sm truncate md:table-cell">
                    {c.description}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Link to={`/products?categoryId=${c.id}`} className="hover:underline">
                      {c.productCount}
                    </Link>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="pr-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${c.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(c)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={c.productCount > 0}
                            onSelect={() => setDeleting(c)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {categories.data && categories.data.meta.total > 0 ? (
          <Pagination
            meta={categories.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>

      <FormDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={editing ? 'Edit category' : 'Add category'}
        {...(editing
          ? { description: 'Changing the code affects only SKUs generated from now on.' }
          : {})}
      >
        <CategoryForm category={editing ?? null} onDone={() => setEditing(undefined)} />
      </FormDialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete category"
        description={`Delete ${deleting?.name ?? ''}? This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteCategory.mutateAsync(deleting.id);
            toast.success(`${deleting.name} deleted`);
          } catch (error) {
            toast.error(
              error instanceof ApiError ? error.message : 'Could not delete the category',
            );
          }
        }}
      />
    </>
  );
}

function CategoryForm({ category, onDone }: { category: CategoryDto | null; onDone: () => void }) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateCategoryInput>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: category
      ? { name: category.name, code: category.code, description: category.description }
      : { name: '', code: '', description: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (category) await update.mutateAsync({ id: category.id, ...values });
      else await create.mutateAsync(values);
      toast.success(category ? 'Category saved' : `${values.name} added`);
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['name', 'code', 'description']));
    }
  });

  return (
    <>
      <form id="category-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormAlert message={formError} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <FormField id="cat-name" label="Name" error={errors.name?.message}>
              <Input {...fieldA11y('cat-name', errors.name?.message)} {...register('name')} />
            </FormField>
          </div>
          <FormField id="cat-code" label="Code" error={errors.code?.message}>
            <Input
              {...fieldA11y('cat-code', errors.code?.message)}
              className="uppercase"
              {...register('code')}
            />
          </FormField>
        </div>
        <FormField id="cat-description" label="Description" error={errors.description?.message}>
          <Input
            {...fieldA11y('cat-description', errors.description?.message)}
            {...register('description')}
          />
        </FormField>
      </form>
      <DialogActions
        formId="category-form"
        submitLabel={category ? 'Save changes' : 'Add category'}
        pending={isSubmitting}
        onCancel={onDone}
      />
    </>
  );
}
