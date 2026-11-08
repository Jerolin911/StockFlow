import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const ALL = '__all__';

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string | undefined) => void;
  options: { value: string; label: string }[];
  allLabel: string;
  className?: string;
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  className,
}: FilterSelectProps) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={cn('w-44', className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface SearchInputProps {
  value: string;
  onChange: (value: string | undefined) => void;
  placeholder: string;
  label: string;
}

/** Search box that reports changes after the user pauses typing. */
export function SearchInput({ value, onChange, placeholder, label }: SearchInputProps) {
  const [text, setText] = useState(value);
  const [lastSent, setLastSent] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Follow changes made elsewhere, such as "Clear filters", but not our own debounced updates.
  if (value !== lastSent) {
    setLastSent(value);
    setText(value);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="relative min-w-56 flex-1 sm:max-w-xs">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input
        type="search"
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            setLastSent(next.trim());
            onChange(next.trim() || undefined);
          }, 300);
        }}
        placeholder={placeholder}
        aria-label={label}
        className="pl-8"
      />
    </div>
  );
}
