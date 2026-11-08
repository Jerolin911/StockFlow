import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useProduct, useProducts } from './api';

interface ProductPickerProps {
  id: string;
  value: string;
  onChange: (productId: string) => void;
  activeOnly?: boolean;
  excludeIds?: string[];
  invalid?: boolean;
  label: string;
}

/** Searchable product selector backed by the products API. */
export function ProductPicker({
  id,
  value,
  onChange,
  activeOnly,
  excludeIds = [],
  invalid,
  label,
}: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = useProduct(value || undefined);
  const results = useProducts({
    search: search || undefined,
    pageSize: 20,
    ...(activeOnly ? { status: 'active' } : {}),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          aria-invalid={invalid || undefined}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value
              ? selected.data
                ? `${selected.data.sku} — ${selected.data.name}`
                : 'Loading…'
              : 'Select a product'}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search name or SKU" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{results.isPending ? 'Searching…' : 'No products found.'}</CommandEmpty>
            <CommandGroup>
              {(results.data?.data ?? [])
                .filter((p) => p.id === value || !excludeIds.includes(p.id))
                .map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => {
                      onChange(p.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn(p.id === value ? 'opacity-100' : 'opacity-0')} />
                    <span className="font-mono text-xs">{p.sku}</span>
                    <span className="truncate">{p.name}</span>
                    {p.isActive ? null : (
                      <span className="text-muted-foreground ml-auto text-xs">Inactive</span>
                    )}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
