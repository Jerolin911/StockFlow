import type { Response } from 'express';
import { Types } from 'mongoose';
import { MAX_REPORT_DAYS, type ReportInterval, type TrendDto } from '@stockflow/shared';
import { validation } from '../common/documents.js';

const DAY = 86_400_000;
/** CSV exports are capped so one request can't serialise an unbounded collection. */
export const CSV_ROW_LIMIT = 10_000;

export interface ResolvedRange {
  from: Date;
  /** Exclusive: the start of the day after the last day in range. */
  until: Date;
  fromIso: string;
  toIso: string;
  days: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Defaults to the last 30 days, ending today (UTC). */
export function resolveRange(query: {
  from?: string | undefined;
  to?: string | undefined;
}): ResolvedRange {
  const today = iso(new Date());
  const toIso = query.to ?? today;
  const fromIso = query.from ?? iso(new Date(Date.parse(`${toIso}T00:00:00Z`) - 29 * DAY));
  const from = new Date(`${fromIso}T00:00:00.000Z`);
  const until = new Date(Date.parse(`${toIso}T00:00:00.000Z`) + DAY);
  const days = Math.round((until.getTime() - from.getTime()) / DAY);
  if (days > MAX_REPORT_DAYS) {
    throw validation('from', `Choose a range of at most ${MAX_REPORT_DAYS} days`);
  }
  return { from, until, fromIso, toIso, days };
}

export function pickInterval(days: number, requested?: ReportInterval): ReportInterval {
  if (requested) return requested;
  if (days <= 62) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}

/** Mongo expression for the start of the period a date falls in (UTC, weeks start Monday). */
export const periodExpr = (field: string, interval: ReportInterval) => ({
  $dateToString: {
    format: '%Y-%m-%d',
    date: { $dateTrunc: { date: field, unit: interval, startOfWeek: 'monday', timezone: 'UTC' } },
  },
});

/** Every period start between from and until, so empty periods show as zero. */
export function periodsIn(range: ResolvedRange, interval: ReportInterval): string[] {
  const start = new Date(range.from);
  if (interval === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (interval === 'month') start.setUTCDate(1);
  const periods: string[] = [];
  for (const d = start; d < range.until;) {
    periods.push(iso(d));
    if (interval === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (interval === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return periods;
}

/** Fills a trend from aggregated rows of { _id: { period, key }, value }. */
export function buildTrend(
  range: ResolvedRange,
  interval: ReportInterval,
  series: TrendDto['series'],
  rows: { period: string; key: string; value: number }[],
): TrendDto {
  const byPeriod = new Map<string, Record<string, number>>();
  for (const period of periodsIn(range, interval)) {
    byPeriod.set(period, Object.fromEntries(series.map((s) => [s.key, 0])));
  }
  for (const row of rows) {
    const values = byPeriod.get(row.period);
    if (values && row.key in values) values[row.key] = (values[row.key] ?? 0) + row.value;
  }
  return {
    interval,
    from: range.fromIso,
    to: range.toIso,
    series,
    points: [...byPeriod.entries()].map(([period, values]) => ({ period, values })),
  };
}

export const oid = (id: string) => new Types.ObjectId(id);

export const round = (value: number, places = 1) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

export const ratio = (part: number, whole: number) => (whole > 0 ? round(part / whole, 4) : null);

// CSV

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Quote anything with a delimiter, quote or line break; neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value === 'string' ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function sendCsv<T>(res: Response, filename: string, columns: CsvColumn<T>[], rows: T[]) {
  const lines = [
    columns.map((c) => cell(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => cell(c.value(row))).join(',')),
  ];
  res
    .status(200)
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${filename}.csv"`)
    .send(`\uFEFF${lines.join('\r\n')}\r\n`);
}

/** Pages an in-memory result, or sends all of it as CSV. */
export function sendTable<T>(
  res: Response,
  query: { page: number; pageSize: number; format?: 'csv' | undefined },
  rows: T[],
  csv: { filename: string; columns: CsvColumn<T>[] },
) {
  if (query.format === 'csv') {
    sendCsv(res, csv.filename, csv.columns, rows.slice(0, CSV_ROW_LIMIT));
    return;
  }
  const start = (query.page - 1) * query.pageSize;
  res.json({
    data: rows.slice(start, start + query.pageSize),
    meta: { page: query.page, pageSize: query.pageSize, total: rows.length },
  });
}

/** Money in minor units as a plain decimal for spreadsheets. */
export const decimal = (minor: number | null) => (minor === null ? null : (minor / 100).toFixed(2));

export const dateOnly = (value: Date | string | null | undefined) =>
  value ? (typeof value === 'string' ? value.slice(0, 10) : iso(value)) : null;
