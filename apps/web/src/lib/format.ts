const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function formatDateTime(value: string | null | undefined, fallback = '—'): string {
  return value ? dateTime.format(new Date(value)) : fallback;
}

export function formatDate(value: string | null | undefined, fallback = '—'): string {
  return value ? dateOnly.format(new Date(value)) : fallback;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}
