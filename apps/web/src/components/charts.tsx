import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Series colours: slots 1 and 2 of the validated reference categorical palette, in fixed
 * order (blue, orange). Single-series charts use slot 1. Values and labels stay in text ink.
 */
export const SERIES_COLORS = ['#2a78d6', '#eb6834'] as const;

const number = new Intl.NumberFormat();
export const formatCount = (value: number) => number.format(value);

/** Rounds up to 1, 2 or 5 × 10ⁿ so axis labels are clean numbers. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= value)!;
  return step * magnitude;
}

export function StatTile({
  label,
  value,
  detail,
  to,
  alert,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  to?: string;
  alert?: boolean;
}) {
  const body = (
    <>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold', alert && 'text-red-700')}>{value}</p>
      {detail ? <p className="text-muted-foreground mt-0.5 text-xs">{detail}</p> : null}
    </>
  );
  const className =
    'bg-card block rounded-xl border px-4 py-4 shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
  return to ? (
    <Link to={to} className={cn(className, 'hover:border-primary/40')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  detail?: ReactNode;
}

/** Horizontal bars for one measure across categories, value at each tip. */
export function BarList({
  rows,
  format = formatCount,
  label,
}: {
  rows: BarRow[];
  format?: (value: number) => string;
  label: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No data.</p>;
  return (
    <ul className="grid gap-3" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{row.label}</span>
            <span className="text-foreground font-medium tabular-nums">{format(row.value)}</span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
            <div
              className="h-full rounded-full"
              style={{
                width: `${max > 0 ? Math.max((row.value / max) * 100, row.value > 0 ? 1 : 0) : 0}%`,
                backgroundColor: SERIES_COLORS[0],
              }}
            />
          </div>
          {row.detail ? <p className="text-muted-foreground text-xs">{row.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export interface ColumnSeries {
  key: string;
  label: string;
}

export interface ColumnPoint {
  key: string;
  label: string;
  values: Record<string, number>;
}

/**
 * Columns over time for one or two series that share a unit (never two scales on one
 * axis). Hover or focus a period for its values; the table view lists every value.
 */
export function ColumnChart({
  points,
  series,
  format = formatCount,
  label,
  height = 176,
}: {
  points: ColumnPoint[];
  series: ColumnSeries[];
  format?: (value: number) => string;
  label: string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(
    Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0))),
  );
  const ticks = [max, max / 2, 0];
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const total = (key: string) => points.reduce((s, p) => s + (p.values[key] ?? 0), 0);

  return (
    // grid-cols-1 caps the track at the figure's width; an auto track grows to the axis labels'
    // combined width and pushes the chart past a phone screen.
    <figure className="grid grid-cols-1 gap-3" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {series.length > 1 ? (
          <ul className="flex flex-wrap gap-4 text-xs" aria-label="Legend">
            {series.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: SERIES_COLORS[i] }}
                  aria-hidden
                />
                <span className="text-muted-foreground">
                  {s.label}{' '}
                  <span className="text-foreground font-medium tabular-nums">
                    {format(total(s.key))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">
            Total{' '}
            <span className="text-foreground font-medium tabular-nums">
              {format(total(series[0]!.key))}
            </span>
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>

      {asTable ? (
        <div className="max-h-72 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Period</TableHead>
                {series.map((s) => (
                  <TableHead key={s.key} className="pr-3 text-right">
                    {s.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => (
                <TableRow key={p.key}>
                  <TableCell className="pl-3">{p.label}</TableCell>
                  {series.map((s) => (
                    <TableCell key={s.key} className="pr-3 text-right tabular-nums">
                      {format(p.values[s.key] ?? 0)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex gap-2">
          <div
            className="text-muted-foreground flex flex-col justify-between text-right text-[11px] tabular-nums"
            style={{ height }}
            aria-hidden
          >
            {ticks.map((t) => (
              <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
                {format(t)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative" style={{ height }} onMouseLeave={() => setActive(null)}>
              {ticks.map((t, i) => (
                <div
                  key={t}
                  className="border-border/70 absolute inset-x-0 border-t"
                  style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
                  aria-hidden
                />
              ))}
              <div className="absolute inset-0 flex items-end">
                {points.map((p, index) => (
                  <div
                    key={p.key}
                    role="img"
                    tabIndex={0}
                    aria-label={`${p.label}: ${series.map((s) => `${s.label} ${format(p.values[s.key] ?? 0)}`).join(', ')}`}
                    className={cn(
                      'relative flex h-full flex-1 items-end justify-center gap-[2px] px-[1px] outline-none',
                      active === index && 'bg-muted/60',
                    )}
                    onMouseEnter={() => setActive(index)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                  >
                    {series.map((s, i) => {
                      const value = p.values[s.key] ?? 0;
                      return (
                        <div
                          key={s.key}
                          className="w-full max-w-6 rounded-t-[4px]"
                          style={{
                            height: `${(value / max) * 100}%`,
                            minHeight: value > 0 ? 2 : 0,
                            backgroundColor: SERIES_COLORS[i],
                          }}
                        />
                      );
                    })}
                    {active === index ? (
                      <div
                        className={cn(
                          'bg-popover text-popover-foreground pointer-events-none absolute bottom-full z-10 mb-1 rounded-md border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md',
                          index > points.length / 2 ? 'right-0' : 'left-0',
                        )}
                      >
                        <p className="font-medium">{p.label}</p>
                        {series.map((s, i) => (
                          <p key={s.key} className="flex items-center gap-1.5">
                            <span
                              className="size-2 rounded-sm"
                              style={{ backgroundColor: SERIES_COLORS[i] }}
                            />
                            <span className="text-muted-foreground">{s.label}</span>
                            <span className="ml-auto pl-2 font-medium tabular-nums">
                              {format(p.values[s.key] ?? 0)}
                            </span>
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="text-muted-foreground mt-1 flex text-[11px]" aria-hidden>
              {points.map((p, index) => (
                <span key={p.key} className="flex-1 truncate text-center">
                  {index % labelEvery === 0 ? p.label : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}
