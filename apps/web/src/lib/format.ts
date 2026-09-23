const LITRE_FORMAT = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 0,
});

const PRECISE_LITRE_FORMAT = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const PERCENT_FORMAT = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatLitres(litres: number | null | undefined): string {
  if (litres === null || litres === undefined || !Number.isFinite(litres)) {
    return 'No reading';
  }
  return `${LITRE_FORMAT.format(litres)} L`;
}

export function formatLitresPrecise(litres: number | null | undefined): string {
  if (litres === null || litres === undefined || !Number.isFinite(litres)) {
    return 'No reading';
  }
  return `${PRECISE_LITRE_FORMAT.format(litres)} L`;
}

export function formatMillilitresAsLitres(millilitres: number | null | undefined): string {
  if (millilitres === null || millilitres === undefined || !Number.isFinite(millilitres)) {
    return 'No reading';
  }
  return formatLitres(millilitres / 1000);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'No reading';
  }
  return `${PERCENT_FORMAT.format(value)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDateTime(iso: string | null | undefined, timeZone = 'UTC'): string {
  if (iso === null || iso === undefined || iso === '') {
    return 'Not recorded';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Invalid time';
  }
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date);
  }
}

export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (iso === null || iso === undefined || iso === '') {
    return 'No reading';
  }
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return 'Unknown age';
  }
  const delta = now - at;
  if (delta < 0) {
    return 'Ahead of this clock';
  }
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} h ago`;
  }
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * Converts a `datetime-local` wall time in a station timezone to a UTC ISO
 * string with a Z offset, which is what the ingestion schema accepts.
 * East African zones do not observe daylight saving; the second offset read
 * still corrects a guess that landed across an offset boundary elsewhere.
 */
export function wallTimeToUtcIso(wall: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wall.trim());
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (
    !Number.isFinite(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const corrected = utcGuess - timeZoneOffsetMs(timeZone, new Date(utcGuess));
  const offset = timeZoneOffsetMs(timeZone, new Date(corrected));
  return new Date(utcGuess - offset).toISOString();
}

function timeZoneOffsetMs(timeZone: string, date: Date): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
  } catch {
    return 0;
  }
  const pick = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour'),
    pick('minute'),
    pick('second'),
  );
  if (Number.isNaN(asUtc)) {
    return 0;
  }
  return asUtc - date.getTime();
}

export function litresFromMl(millilitres: number | null | undefined): string {
  return formatMillilitresAsLitres(millilitres);
}

export function formatWhen(iso: string | null | undefined, timeZone = 'UTC'): string {
  return formatDateTime(iso, timeZone);
}

export function formatCount(value: number | null | undefined): string {
  return formatNumber(value, 0);
}

export function titleCase(value: string): string {
  return value
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
