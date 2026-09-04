import { describe, expect, it } from 'vitest';
import { addColumn, addRow, cellAt, cellsOf, formatTable, newTable, removeRow, stepCell, tableAt, tidyTable } from './tables';

const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');

/** The offset of the first character of a line. */
const lineStart = (body: string, line: number): number =>
  body
    .split('\n')
    .slice(0, line)
    .reduce((at, l) => at + l.length + 1, 0);

describe('cellsOf', () => {
  it('drops the outer pipes and trims each cell', () => {
    expect(cellsOf('| a | b |')).toEqual(['a', 'b']);
    expect(cellsOf('a | b')).toEqual(['a', 'b']);
    expect(cellsOf('|a|b|')).toEqual(['a', 'b']);
  });

  it('keeps an escaped pipe inside a cell', () => {
    expect(cellsOf('| a \\| b | c |')).toEqual(['a \\| b', 'c']);
  });

  it('keeps an empty cell in the middle', () => {
    expect(cellsOf('| a |  | c |')).toEqual(['a', '', 'c']);
  });
});

describe('tableAt', () => {
  it('finds the table a line is in, separator and all', () => {
    const t = tableAt(TABLE, 2);
    expect(t).not.toBeNull();
    expect(t?.first).toBe(0);
    expect(t?.last).toBe(3);
    expect(t?.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('reads each column’s alignment off the separator', () => {
    const t = tableAt('| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |', 0);
    expect(t?.align).toEqual(['left', 'center', 'right']);
  });

  it('is nothing for a line of pipes with no separator under it', () => {
    expect(tableAt('| a | b |\n| 1 | 2 |', 0)).toBeNull();
    expect(tableAt('just words', 0)).toBeNull();
  });

  it('stops at the blank line that ends the table', () => {
    const body = `${TABLE}\n\n| x |\n| --- |`;
    expect(tableAt(body, 0)?.last).toBe(3);
  });
});

describe('cellAt', () => {
  it('says which row and column an offset is in', () => {
    expect(cellAt(TABLE, lineStart(TABLE, 2) + 3)).toMatchObject({ row: 1, col: 0 });
    expect(cellAt(TABLE, lineStart(TABLE, 2) + 7)).toMatchObject({ row: 1, col: 1 });
    expect(cellAt(TABLE, 3)).toMatchObject({ row: 0, col: 0 });
  });

  it('is nothing outside a table', () => {
    expect(cellAt('plain words', 3)).toBeNull();
  });
});

describe('formatTable', () => {
  it('lines the pipes up on the widest cell in each column', () => {
    const t = tableAt('| name | n |\n| --- | --- |\n| Kitchen rebuild | 2 |', 0);
    expect(formatTable(t!)).toEqual(['| name            | n   |', '| --------------- | --- |', '| Kitchen rebuild | 2   |']);
  });

  it('writes the alignment back into the separator', () => {
    const t = tableAt('| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |', 0);
    expect(formatTable(t!)[1]).toBe('| :-- | :-: | --: |');
  });

  it('keeps a short column three dashes wide, as markdown wants', () => {
    const t = tableAt('| a |\n| - |\n| b |', 0);
    expect(formatTable(t!)[1]).toBe('| --- |');
  });
});

describe('stepCell', () => {
  it('goes to the next cell along', () => {
    const r = stepCell(TABLE, lineStart(TABLE, 2) + 3, 1);
    expect(cellAt(r!.body, r!.caret)).toMatchObject({ row: 1, col: 1 });
  });

  it('wraps to the first cell of the row below', () => {
    const r = stepCell(TABLE, lineStart(TABLE, 2) + 7, 1);
    expect(cellAt(r!.body, r!.caret)).toMatchObject({ row: 2, col: 0 });
  });

  it('makes a row rather than falling out of the table', () => {
    const r = stepCell(TABLE, lineStart(TABLE, 3) + 7, 1);
    expect(r!.body.split('\n')).toHaveLength(5);
    expect(cellAt(r!.body, r!.caret)).toMatchObject({ row: 3, col: 0 });
  });

  it('goes back, and to the end of the row above', () => {
    const r = stepCell(TABLE, lineStart(TABLE, 3) + 3, -1);
    expect(cellAt(r!.body, r!.caret)).toMatchObject({ row: 1, col: 1 });
  });

  it('stays in the first cell rather than going nowhere', () => {
    const r = stepCell(TABLE, 3, -1);
    expect(cellAt(r!.body, r!.caret)).toMatchObject({ row: 0, col: 0 });
  });

  it('is nothing outside a table, so Tab keeps its usual meaning', () => {
    expect(stepCell('plain words', 3, 1)).toBeNull();
  });

  it('lays the table out as it goes', () => {
    const ragged = '|a|b|\n|-|-|\n|longer|2|';
    const r = stepCell(ragged, 3, 1);
    expect(r!.body).toContain('| a      | b   |');
  });
});

describe('adding and removing', () => {
  it('adds a row under the caret’s row', () => {
    const r = addRow(TABLE, lineStart(TABLE, 2) + 3);
    expect(r!.body.split('\n')).toHaveLength(5);
    expect(cellAt(r!.body, r!.caret)).toMatchObject({ row: 2, col: 0 });
    expect(r!.body.split('\n')[3].trim()).toBe('|     |     |');
  });

  it('adds a column after the caret’s column, in every row', () => {
    const r = addColumn(TABLE, lineStart(TABLE, 2) + 3);
    const t = tableAt(r!.body, 0);
    expect(t!.rows.every((row) => row.length === 3)).toBe(true);
    expect(t!.align).toHaveLength(3);
    expect(cellAt(r!.body, r!.caret)).toMatchObject({ row: 1, col: 1 });
  });

  it('takes a row out, but never the header and never the last one', () => {
    const r = removeRow(TABLE, lineStart(TABLE, 2) + 3);
    expect(tableAt(r!.body, 0)!.rows).toEqual([
      ['a', 'b'],
      ['3', '4'],
    ]);
    expect(removeRow(TABLE, 3)).toBeNull();
    expect(removeRow('| a |\n| --- |\n| 1 |', lineStart('| a |\n| --- |\n| 1 |', 2) + 2)).toBeNull();
  });
});

describe('tidyTable', () => {
  it('lines a hand-typed table up and leaves the caret where it was', () => {
    const ragged = '|name|n|\n|-|-|\n|Kitchen|2|\n|Hall|10|';
    const r = tidyTable(ragged, lineStart(ragged, 2) + 2);
    // A column narrower than three characters is still padded to three: the
    // separator needs three dashes, and the pipes have to line up with it.
    expect(r!.body.split('\n')).toEqual(['| name    | n   |', '| ------- | --- |', '| Kitchen | 2   |', '| Hall    | 10  |']);
    expect(cellAt(r!.body, r!.caret)).toMatchObject({ row: 1, col: 0 });
  });

  it('fills a short row out to the width of the table', () => {
    const r = tidyTable('| a | b | c |\n| - | - | - |\n| 1 |', 0);
    expect(tableAt(r!.body, 0)!.rows[1]).toEqual(['1', '', '']);
  });
});

describe('newTable', () => {
  it('is a table the moment it is written', () => {
    const t = tableAt(newTable(3, 2), 0);
    expect(t!.rows).toHaveLength(3);
    expect(t!.rows[0]).toHaveLength(3);
  });

  it('and one the formatter leaves alone', () => {
    const made = newTable();
    expect(formatTable(tableAt(made, 0)!).join('\n')).toBe(made);
  });
});
