/**
 * Money is stored as integer minor units. Only two-decimal currencies are offered,
 * so one minor unit is always 1/100 of the major unit.
 */
export const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'AUD',
  'CAD',
  'NZD',
  'SGD',
  'AED',
  'ZAR',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'MYR',
] as const;

export type Currency = (typeof CURRENCIES)[number];

export const MAX_MONEY = 10_000_000_000; // 100,000,000.00

/** Parses a non-negative decimal string like "12.5" into minor units (1250). */
export function parseMoney(input: string): number | null {
  const value = input.trim().replace(/,/g, '');
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Formats minor units as a plain decimal string for inputs ("12.50"). */
export function minorToDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parses a percentage string like "7.25" into basis points (725). */
export function parsePercent(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(input.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

export function basisPointsToPercent(bp: number): string {
  return (bp / 100).toFixed(2).replace(/\.?0+$/, '');
}
