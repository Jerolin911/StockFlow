import { useSearchParams } from 'react-router';

/**
 * Filter state kept in the URL so views can be linked and survive a reload.
 * Changing any filter returns to the first page.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((key) => [key, params.get(key) ?? ''])) as Record<
    K,
    string
  >;
  const page = Math.max(1, Number(params.get('page')) || 1);

  const update = (changes: Partial<Record<K | 'page', string | undefined>>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value as string);
          else next.delete(key);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  const clear = () => update(Object.fromEntries(keys.map((k) => [k, undefined])) as never);
  const active = keys.some((key) => values[key] !== '');

  return { values, page, update, clear, active };
}

/** Drops empty values so they aren't sent as query parameters. */
export function compact<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== '' && v !== undefined && v !== null),
  ) as Partial<T>;
}
