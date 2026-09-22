/**
 * Exact quantity arithmetic.
 *
 * TRD section 4 and the database skill require inventory to be held in decimal
 * or numeric types rather than binary floating point, because error accumulates
 * across thousands of readings and a reconciliation report must not invent or
 * lose litres.
 *
 * Convention used across the domain:
 *   - volumes are integer *millilitres* (`Millilitres`),
 *   - levels are integer *millimetres* (`Millimetres`),
 *   - litres appear only at a boundary: HTTP payloads, vendor strapping tables
 *     and the `numeric` columns, where they are converted immediately.
 *
 * All arithmetic therefore happens on integers, which is exact, and the only
 * rounding is the single, documented rounding at a conversion boundary.
 */

/** Integer millilitres. Volumes are never held as a fractional number. */
export type Millilitres = number;

/** Integer millimetres. Levels are never held as a fractional number. */
export type Millimetres = number;

/** Millilitres per litre. */
export const ML_PER_LITRE = 1000;

/** Millimetres per metre. */
export const MM_PER_METRE = 1000;

/**
 * Rounds half away from zero, matching the rounding the `numeric(14,3)`
 * columns apply when a value is written with more than three decimals.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Converts litres to integer millilitres. Rejects non-finite input. */
export function litresToMl(litres: number): Millilitres {
  if (!Number.isFinite(litres)) {
    throw new RangeError(`litresToMl received a non-finite value: ${String(litres)}`);
  }
  return roundHalfAwayFromZero(litres * ML_PER_LITRE);
}

/**
 * Converts integer millilitres to litres. Intended for display and for the
 * database boundary only; never feed the result back into inventory arithmetic.
 */
export function mlToLitres(millilitres: Millilitres): number {
  return millilitres / ML_PER_LITRE;
}

/** Renders millilitres as an exact decimal litre string with three places. */
export function formatLitres(millilitres: Millilitres, decimals = 3): string {
  const places = Math.max(0, Math.min(3, Math.trunc(decimals)));
  const negative = millilitres < 0;
  const absolute = Math.abs(millilitres);
  const whole = Math.trunc(absolute / ML_PER_LITRE);
  const fraction = absolute - whole * ML_PER_LITRE;
  const fractionText = String(fraction).padStart(3, '0').slice(0, places);
  const sign = negative ? '-' : '';
  return places === 0 ? `${sign}${whole}` : `${sign}${whole}.${fractionText}`;
}

/** Renders millilitres as an exact decimal litre string with three places. */
export function litresString(millilitres: Millilitres): string {
  return formatLitres(millilitres, 3);
}

/**
 * Parses a litre value that arrived as a decimal (`"1234.567"`, a Prisma
 * `Decimal`, or a JSON number) into integer millilitres. Fractional millilitres
 * are rounded half away from zero, which is what the database does.
 */
export function parseLitresToMl(value: string | number | { toString(): string }): Millilitres {
  const text = typeof value === 'string' ? value : value.toString();
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new RangeError('parseLitresToMl received an empty value');
  }
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (match === null || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new RangeError(`parseLitresToMl received a non-numeric value: ${trimmed}`);
  }
  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] === '' ? 0 : Number(match[2]);
  const fractionDigits = match[3] ?? '';
  const padded = `${fractionDigits}0000`.slice(0, 4);
  const fraction = Number(padded);
  if (!Number.isSafeInteger(whole) || !Number.isFinite(fraction)) {
    throw new RangeError(`parseLitresToMl received an out-of-range value: ${trimmed}`);
  }
  // Keep three decimals exactly and round the fourth half away from zero.
  const thousandths = Math.trunc(fraction / 10);
  const remainder = fraction - thousandths * 10;
  const rounded = remainder >= 5 ? thousandths + 1 : thousandths;
  return sign * (whole * ML_PER_LITRE + rounded);
}

/** Adds any number of millilitre amounts. */
export function sumMl(values: ReadonlyArray<Millilitres>): Millilitres {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

/** Percentage of `total` represented by `part`, clamped to a sane range. */
export function percentOf(part: Millilitres, total: Millilitres): number {
  if (total <= 0) {
    return 0;
  }
  return (part / total) * 100;
}

/**
 * Converts a rate in litres per hour to millilitres per hour. Thresholds are
 * configured by operators in litres, which is how dockets and gauges are
 * labelled, but every comparison happens in millilitres.
 */
export function litresPerHourToMlPerHour(litresPerHour: number): number {
  return litresToMl(litresPerHour);
}

/** True when the value is a safe integer number of millilitres. */
export function isMillilitres(value: unknown): value is Millilitres {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Rounds a millimetre level to the precision the platform stores (0.01 mm). */
export function roundLevelMm(levelMm: number): number {
  if (!Number.isFinite(levelMm)) {
    return 0;
  }
  return Math.round(levelMm * 100) / 100;
}
