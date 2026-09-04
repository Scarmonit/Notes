/**
 * Markdown tables, while they are being typed.
 *
 * A table is the one common block the editor did not help with: pipes drift,
 * the separator row has to be counted out by hand, and adding a column means
 * editing every line. Everything here works on the markdown text and the
 * caret's offset in it — never on the DOM — so the same functions serve the
 * Tab key, the shortcut and anything that comes later.
 *
 * What counts as a table is what GitHub-flavoured markdown counts as one, and
 * what the preview will draw: a header row of `|` cells, a separator row of
 * dashes with optional colons, and rows under it. A leading and trailing pipe
 * are optional in markdown; they are written when the app makes a row,
 * because that is how a table reads as a table in plain text.
 */

export interface Table {
  /** The first and last line of the table, counted from 0. */
  first: number;
  last: number;
  /** Every row's cells, the separator row taken out. */
  rows: string[][];
  /** Which row of `rows` the separator sits under: always 0, kept for clarity. */
  headerRow: number;
  /** Each column's alignment, from the separator row. `default` is a bare `---`, which reads left. */
  align: Align[];
}

/** Where the caret is, as a table sees it. */
export interface CellAt {
  table: Table;
  /** The row of `table.rows` the caret is in. */
  row: number;
  /** The column it is in. */
  col: number;
}

/** What a column's separator cell says: nothing, or which way the cells read. */
export type Align = 'default' | 'left' | 'center' | 'right';

const SEPARATOR = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

/** A line that could be part of a table: it has a pipe that is not escaped. */
function hasPipe(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && line[i - 1] !== '\\') return true;
  }
  return false;
}

/** One row's cells, the outer pipes dropped and each cell trimmed. */
export function cellsOf(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '|') {
      cell += '\\|';
      i++;
    } else if (c === '|') {
      cells.push(cell);
      cell = '';
    } else cell += c;
  }
  cells.push(cell);
  // A leading or trailing pipe makes an empty cell at each end; markdown says
  // those are the edge of the table, not a column.
  if (cells.length > 1 && cells[0].trim() === '' && /^[ \t]*\|/.test(line)) cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === '' && /\|[ \t]*$/.test(line)) cells.pop();
  return cells.map((c) => c.trim());
}

const alignOf = (cell: string): Align => {
  const t = cell.trim();
  if (t.startsWith(':') && t.endsWith(':')) return 'center';
  if (t.endsWith(':')) return 'right';
  // A leading colon means left on purpose; a bare run of dashes means nothing
  // was said. Both read left, and both are written back as they were found.
  return t.startsWith(':') ? 'left' : 'default';
};

/** The table the given line is part of, or null when that line is not in one. */
export function tableAt(body: string, line: number): Table | null {
  const lines = body.split('\n');
  if (line < 0 || line >= lines.length || !hasPipe(lines[line])) return null;
  // The separator is the second line of a table, so find the run of piped
  // lines around this one and check that the second of them is a separator.
  let first = line;
  while (first > 0 && hasPipe(lines[first - 1])) first--;
  let last = line;
  while (last + 1 < lines.length && hasPipe(lines[last + 1])) last++;
  if (last - first < 1 || !SEPARATOR.test(lines[first + 1])) return null;
  const align = cellsOf(lines[first + 1]).map(alignOf);
  const rows = lines.slice(first, last + 1).filter((_, i) => i !== 1).map(cellsOf);
  return { first, last, rows, headerRow: 0, align };
}

/** How far into the body a line starts. */
function startOfLine(body: string, line: number): number {
  const lines = body.split('\n');
  let at = 0;
  for (let i = 0; i < line && i < lines.length; i++) at += lines[i].length + 1;
  return at;
}

/** Which cell an offset in the body falls in, or null when it is not in a table. */
export function cellAt(body: string, offset: number): CellAt | null {
  const before = body.slice(0, Math.max(0, offset));
  const line = before.split('\n').length - 1;
  const table = tableAt(body, line);
  if (!table) return null;
  if (line === table.first + 1) return { table, row: 0, col: 0 };
  const row = line < table.first + 1 ? line - table.first : line - table.first - 1;
  const text = body.slice(startOfLine(body, line), offset);
  // The cell is the number of unescaped pipes before the caret, less the one
  // that opens the row when the row starts with a pipe.
  let pipes = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '|' && text[i - 1] !== '\\') pipes++;
  const opens = /^[ \t]*\|/.test(body.slice(startOfLine(body, line)).split('\n')[0]);
  const col = Math.max(0, Math.min((table.rows[row]?.length ?? 1) - 1, pipes - (opens ? 1 : 0)));
  return { table, row, col };
}

const widthOf = (cell: string): number => [...cell].length;

/** A separator cell of a given width and alignment: `:---`, `---:`, `:--:`. */
function separatorCell(width: number, align: Align): string {
  const dashes = Math.max(3, width);
  if (align === 'center') return `:${'-'.repeat(Math.max(1, dashes - 2))}:`;
  if (align === 'right') return `${'-'.repeat(Math.max(2, dashes - 1))}:`;
  if (align === 'left') return `:${'-'.repeat(Math.max(2, dashes - 1))}`;
  return '-'.repeat(dashes);
}

/**
 * The table written out with every column as wide as its widest cell, pipes
 * lined up down the page. What the preview draws does not change; what the
 * writer sees while typing does.
 */
export function formatTable(table: Table): string[] {
  const columns = Math.max(...table.rows.map((r) => r.length), table.align.length, 1);
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) widths.push(Math.max(3, ...table.rows.map((r) => widthOf(r[c] ?? ''))));
  const align = (cell: string, c: number): string => {
    const pad = widths[c] - widthOf(cell);
    if (table.align[c] === 'right') return `${' '.repeat(pad)}${cell}`;
    if (table.align[c] === 'center') {
      const left = Math.floor(pad / 2);
      return `${' '.repeat(left)}${cell}${' '.repeat(pad - left)}`;
    }
    return `${cell}${' '.repeat(pad)}`;
  };
  const row = (cells: string[]): string => `| ${Array.from({ length: columns }, (_, c) => align(cells[c] ?? '', c)).join(' | ')} |`;
  const separator = `| ${Array.from({ length: columns }, (_, c) => separatorCell(widths[c], table.align[c] ?? 'default')).join(' | ')} |`;
  return [row(table.rows[0] ?? []), separator, ...table.rows.slice(1).map(row)];
}

/** The body with a table's lines replaced by new ones. */
function replace(body: string, table: Table, lines: string[]): string {
  const all = body.split('\n');
  return [...all.slice(0, table.first), ...lines, ...all.slice(table.last + 1)].join('\n');
}

export interface TableEdit {
  body: string;
  /** Where the caret should sit afterwards, as an offset in the new body. */
  caret: number;
}

/** The offset of the start of a cell's text in a formatted table. */
function caretInCell(body: string, table: Table, lines: string[], row: number, col: number): number {
  const line = table.first + (row === 0 ? 0 : row + 1);
  const text = lines[row === 0 ? 0 : row + 1] ?? '';
  let at = 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '|' && text[i - 1] !== '\\') {
      if (seen === col) {
        at = i + 2;
        break;
      }
      seen++;
    }
  }
  return startOfLine(body, line) + Math.min(at, text.length);
}

/** Lays the table out again and puts the caret in one of its cells. */
function settled(body: string, table: Table, rows: string[][], row: number, col: number): TableEdit {
  const next: Table = { ...table, rows };
  const lines = formatTable(next);
  const written = replace(body, table, lines);
  const kept: Table = { ...next, last: table.first + lines.length - 1 };
  return { body: written, caret: caretInCell(written, kept, lines, Math.max(0, Math.min(rows.length - 1, row)), col) };
}

/**
 * Tab in a table: the next cell, wrapping to the row below, and a new row at
 * the end rather than falling out of the table. Shift+Tab goes back.
 */
export function stepCell(body: string, offset: number, delta: 1 | -1): TableEdit | null {
  const at = cellAt(body, offset);
  if (!at) return null;
  const { table } = at;
  const columns = Math.max(...table.rows.map((r) => r.length), 1);
  const rows = table.rows.map((r) => Array.from({ length: columns }, (_, c) => r[c] ?? ''));
  let row = at.row;
  let col = at.col + delta;
  if (col >= columns) {
    col = 0;
    row++;
    if (row >= rows.length) rows.push(Array.from({ length: columns }, () => ''));
  } else if (col < 0) {
    if (row === 0) return settled(body, table, rows, 0, 0);
    row--;
    col = columns - 1;
  }
  return settled(body, table, rows, row, col);
}

/** A row added under the caret's row, or a column added after the caret's column. */
export function addRow(body: string, offset: number): TableEdit | null {
  const at = cellAt(body, offset);
  if (!at) return null;
  const columns = Math.max(...at.table.rows.map((r) => r.length), 1);
  const rows = at.table.rows.map((r) => Array.from({ length: columns }, (_, c) => r[c] ?? ''));
  rows.splice(at.row + 1, 0, Array.from({ length: columns }, () => ''));
  return settled(body, at.table, rows, at.row + 1, 0);
}

export function addColumn(body: string, offset: number): TableEdit | null {
  const at = cellAt(body, offset);
  if (!at) return null;
  const columns = Math.max(...at.table.rows.map((r) => r.length), 1);
  const rows = at.table.rows.map((r) => {
    const filled = Array.from({ length: columns }, (_, c) => r[c] ?? '');
    filled.splice(at.col + 1, 0, '');
    return filled;
  });
  const align = [...at.table.align];
  align.splice(at.col + 1, 0, 'default');
  return settled(body, { ...at.table, align }, rows, at.row, at.col + 1);
}

/** Takes the caret's row out; the header row is not one a table can lose. */
export function removeRow(body: string, offset: number): TableEdit | null {
  const at = cellAt(body, offset);
  if (!at || at.row === 0 || at.table.rows.length <= 2) return null;
  const rows = at.table.rows.filter((_, i) => i !== at.row);
  return settled(body, at.table, rows, Math.min(at.row, rows.length - 1), at.col);
}

/** Lays the caret's table out with its pipes lined up. */
export function tidyTable(body: string, offset: number): TableEdit | null {
  const at = cellAt(body, offset);
  if (!at) return null;
  const columns = Math.max(...at.table.rows.map((r) => r.length), at.table.align.length, 1);
  const rows = at.table.rows.map((r) => Array.from({ length: columns }, (_, c) => r[c] ?? ''));
  return settled(body, at.table, rows, at.row, at.col);
}

/** The markdown for a fresh table of the given size, ready to type into. */
export function newTable(columns = 3, rows = 2): string {
  const table: Table = {
    first: 0,
    last: 0,
    rows: Array.from({ length: rows + 1 }, () => Array.from({ length: columns }, () => '')),
    headerRow: 0,
    align: Array.from({ length: columns }, () => 'default' as const),
  };
  return formatTable(table).join('\n');
}
