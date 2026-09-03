import { styleText } from 'node:util';

/**
 * Three ways to print, chosen once: `pretty` for a person at a terminal,
 * `plain` (tab-separated, no colour, no header) for a pipe, `json` for a
 * script. Whether stdout is a terminal picks between the first two; the
 * flags override. Colour follows NO_COLOR and --no-color.
 */

export type Mode = 'pretty' | 'plain' | 'json';

export interface OutputOptions {
  json?: boolean;
  plain?: boolean;
  color?: boolean;
  fields?: string[];
  quiet?: boolean;
  isTTY?: boolean;
  columns?: number;
}

export interface Column {
  key: string;
  label: string;
  /** Right-align numbers. */
  align?: 'left' | 'right';
  /** How the value reads in pretty and plain modes; JSON keeps the raw value. */
  format?: (value: unknown, row: Record<string, unknown>) => string;
  /** A style name for pretty mode. */
  style?: Parameters<typeof styleText>[0];
  /** Cut the column to fit the terminal when the row would otherwise wrap. */
  shrink?: boolean;
}

type Style = Parameters<typeof styleText>[0];

export const relative = (t: number, now = Date.now()): string => {
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w} w ago`;
  return new Date(t).toISOString().slice(0, 10);
};

export const iso = (t: number): string => new Date(t).toISOString();

/** Text one line long, for a table cell. */
export const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

export class Output {
  readonly mode: Mode;
  readonly fields: string[] | null;
  readonly quiet: boolean;
  readonly width: number;
  private readonly useColor: boolean;
  private readonly out: NodeJS.WritableStream;
  private readonly err: NodeJS.WritableStream;

  constructor(options: OutputOptions = {}, out: NodeJS.WritableStream = process.stdout, err: NodeJS.WritableStream = process.stderr) {
    const tty = options.isTTY ?? Boolean((out as NodeJS.WriteStream).isTTY);
    this.mode = options.json ? 'json' : options.plain ? 'plain' : tty ? 'pretty' : 'plain';
    this.fields = options.fields && options.fields.length > 0 ? options.fields : null;
    this.quiet = options.quiet === true;
    this.width = options.columns ?? (Number(process.env.COLUMNS) || (out as NodeJS.WriteStream).columns || 100);
    this.useColor = this.mode === 'pretty' && options.color !== false && !process.env.NO_COLOR && tty;
    this.out = out;
    this.err = err;
  }

  color(style: Style, text: string): string {
    return this.useColor ? styleText(style, text) : text;
  }

  dim(text: string): string {
    return this.color('dim', text);
  }

  bold(text: string): string {
    return this.color('bold', text);
  }

  /** Writes text as it is, with a newline unless it already ends in one. */
  write(text: string): void {
    this.out.write(text.endsWith('\n') || text === '' ? text : `${text}\n`);
  }

  /** A line for the person, not the script: stderr, and silent under --quiet. */
  message(text: string): void {
    if (this.quiet) return;
    this.err.write(`${text}\n`);
  }

  /** Something that went wrong, always shown. */
  error(text: string): void {
    this.err.write(`${this.color('red', 'error:')} ${text}\n`);
  }

  /** One value: JSON when asked, else whatever `pretty` renders. */
  value(value: unknown, pretty: () => string): void {
    if (this.mode === 'json') this.write(JSON.stringify(this.pick(value), null, 2));
    else this.write(pretty());
  }

  /** A list of records as a table, tab-separated lines, or a JSON array. */
  rows(items: Array<Record<string, unknown>>, columns: Column[]): void {
    const cols = this.fields ? this.fields.map((key) => columns.find((c) => c.key === key) ?? { key, label: key }) : columns;
    if (this.mode === 'json') {
      this.write(JSON.stringify(items.map((row) => this.pick(row)), null, 2));
      return;
    }
    const cell = (col: Column, row: Record<string, unknown>): string => {
      const v = row[col.key];
      if (col.format) return col.format(v, row);
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? 'yes' : 'no';
      return oneLine(String(v));
    };
    if (this.mode === 'plain') {
      for (const row of items) this.write(cols.map((c) => cell(c, row).replace(/\t/g, ' ')).join('\t'));
      return;
    }
    if (items.length === 0) return;
    const table = items.map((row) => cols.map((c) => cell(c, row)));
    const widths = cols.map((c, i) => Math.max(c.label.length, ...table.map((r) => r[i].length)));
    // Let one column give way so the row fits the terminal.
    const gap = 2;
    const total = widths.reduce((a, b) => a + b, 0) + gap * (cols.length - 1);
    const shrinkAt = cols.findIndex((c) => c.shrink);
    if (total > this.width && shrinkAt >= 0) widths[shrinkAt] = Math.max(8, widths[shrinkAt] - (total - this.width));
    const pad = (text: string, i: number): string => {
      const w = widths[i];
      const cut = text.length > w ? `${text.slice(0, Math.max(0, w - 1))}…` : text;
      return cols[i].align === 'right' ? cut.padStart(w) : cut.padEnd(w);
    };
    this.write(this.dim(cols.map((c, i) => pad(c.label, i)).join(' '.repeat(gap))).trimEnd());
    for (const r of table) {
      this.write(
        r
          .map((text, i) => {
            const padded = pad(text, i);
            return cols[i].style ? this.color(cols[i].style as Style, padded) : padded;
          })
          .join(' '.repeat(gap))
          .trimEnd(),
      );
    }
  }

  /** Keeps only the requested fields of a record, when --fields was given. */
  private pick(value: unknown): unknown {
    if (!this.fields || !value || typeof value !== 'object' || Array.isArray(value)) return value;
    const row = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of this.fields) if (key in row) out[key] = row[key];
    return out;
  }
}
