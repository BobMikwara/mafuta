/**
 * Report model.
 *
 * Every report, whether it is shown on screen or downloaded as CSV, is built
 * from this one structure. That keeps the arithmetic in one place and makes the
 * export auditable: what the file contains is exactly what the screen showed,
 * including the notes that state the formula and its limitations.
 */
export type ReportCell = string | number | null;

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: 'left' | 'right';
}

export interface ReportRange {
  readonly from: string | null;
  readonly to: string | null;
}

export interface ReportTable {
  /** Machine name, also used in the export filename. */
  readonly report: string;
  readonly title: string;
  readonly generatedAt: string;
  readonly range: ReportRange;
  readonly columns: ReadonlyArray<ReportColumn>;
  readonly rows: ReadonlyArray<Record<string, ReportCell>>;
  /** Whole-report aggregates, rendered as a footer row. */
  readonly totals: Readonly<Record<string, ReportCell>> | null;
  /** Formulas, units and limitations. Never omitted from an export. */
  readonly notes: ReadonlyArray<string>;
}

/**
 * RFC 4180 escaping: fields containing a comma, quote or newline are quoted,
 * and embedded quotes are doubled. Values are never interpreted as formulas by
 * a spreadsheet without the leading characters being escaped, which prevents a
 * tank name from being evaluated as a formula.
 */
export function escapeCsvCell(value: ReportCell): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'number' ? formatNumberCell(value) : sanitizeText(String(value));
  const needsQuoting = /[",\n\r]/.test(text);
  const escaped = text.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

function formatNumberCell(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

/**
 * Neutralises spreadsheet formula injection: a cell that starts with `=`, `+`,
 * `-` or `@` is prefixed with an apostrophe so that a tank or station name
 * taken from user input cannot be evaluated as a formula when the export is
 * opened. Cells that are pure numbers keep their sign and stay numeric.
 */
function sanitizeText(text: string): string {
  if (/^[=+@]/.test(text) || /^-\D/.test(text)) {
    return `'${text}`;
  }
  return text;
}

export function toCsv(table: ReportTable): string {
  const lines: string[] = [];
  lines.push(table.columns.map((column) => escapeCsvCell(column.label)).join(','));
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => escapeCsvCell(formatCell(row[column.key]))).join(','));
  }
  if (table.totals !== null) {
    const totalLine = table.columns.map((column, index) => {
      const value = table.totals?.[column.key];
      if (index === 0 && (value === undefined || value === null)) {
        return 'Total';
      }
      return escapeCsvCell(formatCell(value ?? null));
    });
    lines.push(totalLine.join(','));
  }
  for (const note of table.notes) {
    lines.push(escapeCsvCell(`note: ${note}`));
  }
  return `${lines.join('\n')}\n`;
}

function formatCell(value: ReportCell | undefined): ReportCell {
  return value === undefined ? null : value;
}
