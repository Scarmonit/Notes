// The readability round (0.27.0): one type scale for everything that is not the
// note, a floor under it, two size multipliers the Layout sheet owns, and the
// colours the chrome is allowed to be set in. Read as text, like the other
// tests of the stylesheet and the renderer: the array of commands cannot be
// imported, and a token is a promise made in the file, not at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..', '..');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cli = fs.readFileSync(path.join(root, 'src', 'cli', 'commands', 'app.ts'), 'utf8');

const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is a rule in the stylesheet`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};
const body = (name: string): string => {
  const at = main.indexOf(`function ${name}(`);
  expect(at, `${name} is a function in main.ts`).toBeGreaterThan(-1);
  const open = main.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < main.length; i++) {
    if (main[i] === '{') depth++;
    else if (main[i] === '}' && --depth === 0) return main.slice(open, i + 1);
  }
  return main.slice(open);
};

describe('the type scale', () => {
  it('is five steps in :root, each a multiple of the interface scale', () => {
    expect(rootBlock).toContain('--ui-scale: 1;');
    for (const [step, px] of [
      ['xs', '12.5px'],
      ['sm', '13.5px'],
      ['md', '15px'],
      ['lg', '17px'],
      ['xl', '20px'],
    ]) {
      expect(rootBlock).toContain(`--ui-${step}: calc(${px} * var(--ui-scale));`);
    }
  });

  it('keeps the note on its own multiplier, at the sizes it always had', () => {
    expect(rootBlock).toContain('--reading-scale: 1;');
    expect(rootBlock).toContain('--read: calc(17px * var(--reading-scale));');
    expect(rootBlock).toContain('--read-title: calc(27px * var(--reading-scale));');
    expect(rule('.editor,\n.preview')).toContain('font: var(--read)/1.75 var(--serif);');
    expect(rule('.title')).toContain('font: 600 var(--read-title)/1.2 var(--serif-display);');
  });

  it('sets no text in the window below the floor of the scale', () => {
    // Every px size in a font declaration, with the line it is on. The two
    // that are not the window's own — the PNG export page and the quick-note
    // box, which is a window of its own — are named, not waved through.
    const sizes: Array<{ line: number; px: number; decl: string }> = [];
    css.split('\n').forEach((text, i) => {
      const m = /^\s*font(?:-size)?:\s*([^;]*);/.exec(text);
      if (!m) return;
      for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) sizes.push({ line: i + 1, px: Number(px[1]), decl: text.trim() });
    });
    const small = sizes.filter((s) => s.px < 12.5).map((s) => `${s.line}: ${s.decl}`);
    expect(small).toEqual([]);
    // And the chrome's own declarations are tokens, not literals: what is
    // left in px is the two windows that are not this one.
    const literal = sizes.filter((s) => !/var\(--(ui|read)/.test(s.decl) && !/calc\(\d+px \* var\(--ui-scale\)\)/.test(s.decl));
    expect(literal.map((s) => s.decl)).toEqual(['font: 17px/1.75 var(--serif);', 'font: 17px/1.55 var(--serif);']);
  });

  it('gives the body, the utility register and the key chips their steps', () => {
    expect(rule('html,\nbody')).toContain('font: var(--ui-md)/1.45 var(--utility);');
    expect(rule('.u')).toContain('font-size: var(--ui-xs);');
    expect(rule('.u')).toContain('text-transform: uppercase;');
    expect(rule('kbd')).toContain('font: 500 var(--ui-xs)/1 var(--utility);');
    expect(rule('.sheet-card h2')).toContain('font: 600 var(--ui-xl)/1.2 var(--serif-display);');
    expect(rule('.item-title')).toContain('font: 600 var(--ui-lg)/1.3 var(--serif);');
  });

  it('grows the room around the words with them', () => {
    expect(rootBlock).toContain('--sidebar-w: calc(352px * var(--ui-scale));');
    expect(rootBlock).toContain('--head-h: calc(48px * var(--ui-scale));');
    // The second .menu-item rule is the one that sets the row; the first only spaces its parts.
    const row = css.slice(css.indexOf('.menu-item {\n  display: flex;'));
    expect(row.slice(0, row.indexOf('}'))).toContain('padding: calc(10px * var(--ui-scale)) calc(14px * var(--ui-scale));');
    expect(rule('.palette-row')).toContain('padding: calc(10px * var(--ui-scale)) calc(14px * var(--ui-scale));');
    expect(rule('.item')).toContain('padding: calc(12px * var(--ui-scale)) calc(16px * var(--ui-scale));');
    expect(rule('.palette-card')).toContain('width: min(calc(600px * var(--ui-scale)), calc(100vw - 48px));');
    // A header that no longer fits on one line wraps rather than clips.
    expect(rule('.pane-head')).toContain('min-height: var(--head-h);');
    expect(rule('.pane-head')).not.toMatch(/\n\s*height:/);
    const actions = css.slice(css.indexOf('.pane-actions {\n  display: flex;'));
    expect(actions.slice(0, actions.indexOf('}'))).toContain('flex-wrap: wrap;');
  });
});

describe('the colours the chrome may be set in', () => {
  it('lightens the faint paper to read on both surfaces, and strengthens the one border colour', () => {
    expect(rootBlock).toContain('--paper-faint: #8791a3;');
    expect(rootBlock).toContain('--line: #344055;');
    expect(css).not.toContain('#6b7385');
    expect(css).not.toContain('#242c3b');
  });

  it('sets what a reader is meant to read in the dim paper, keeping faint for what cannot run', () => {
    for (const s of ['.item-snippet', '.item-where', '.palette-hint', '.palette-group', '.key-hint', '.menu-head', '.folder-count', '.rail-head']) {
      expect(rule(s), s).toContain('color: var(--paper-dim);');
    }
    expect(rule('.search::placeholder')).toContain('color: var(--paper-dim);');
    // A disabled row is greyed by colour, at full opacity: present, legible, and plainly not now.
    const disabled = rule('.menu-item:disabled');
    expect(disabled).toContain('color: var(--paper-faint);');
    expect(disabled).not.toContain('opacity: 0.38;');
    expect(rule('.palette-row.disabled')).not.toMatch(/opacity: 0\.\d+;/);
  });

  it('separates the two registers of the pane header by colour, not by hiding either', () => {
    expect(rule('.menu-btn')).toContain('color: var(--paper);');
    expect(rule('.pill')).toContain('color: var(--paper-dim);');
  });
});

describe('the palette names', () => {
  it('are inline, so the letters a query matched are not spaced out by a flex gap', () => {
    const name = rule('.palette-name');
    expect(name).not.toContain('display: flex;');
    expect(name).not.toMatch(/\bgap:/);
    expect(rule('.palette-on')).toContain('display: inline-block;');
  });
});

describe('the key chips', () => {
  it('print a chord as one chip everywhere, the way the menus always did', () => {
    expect(body('chordKeys')).toContain("keyLabel(chord).join('+')");
    expect(body('chordKeys')).not.toContain('for (const part of');
    expect(page).toContain('<kbd class="search-hint">Ctrl+K</kbd>');
  });
});

describe('the two size sliders', () => {
  it('sit first in the Layout sheet, with the decided ranges', () => {
    const sheet = page.slice(page.indexOf('id="layout-sheet"'));
    const ui = sheet.indexOf('id="ui-scale"');
    const reading = sheet.indexOf('id="reading-scale"');
    const width = sheet.indexOf('id="text-w"');
    expect(ui).toBeGreaterThan(-1);
    expect(reading).toBeGreaterThan(ui);
    expect(width).toBeGreaterThan(reading);
    expect(sheet).toContain('<input id="ui-scale" type="range" min="1" max="1.4" step="0.05" aria-label="Interface size" />');
    expect(sheet).toContain('<input id="reading-scale" type="range" min="0.85" max="1.6" step="0.05" aria-label="Reading size" />');
    expect(sheet).toContain('<output id="ui-scale-out" class="u" for="ui-scale">');
    expect(sheet).toContain('<output id="reading-scale-out" class="u" for="reading-scale">');
  });

  it('are state the window keeps, clamped on the way in like the line width', () => {
    expect(main).toContain('  uiScale: number;');
    expect(main).toContain('  readingScale: number;');
    expect(main).toContain('const UI_SCALE_MIN = 1;');
    expect(main).toContain('const UI_SCALE_MAX = 1.4;');
    expect(main).toContain('const READING_SCALE_MIN = 0.85;');
    expect(main).toContain('const READING_SCALE_MAX = 1.6;');
    expect(body('loadUi')).toContain('state.uiScale = clampScale(state.uiScale, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_DEFAULT);');
    expect(body('loadUi')).toContain('state.readingScale = clampScale(state.readingScale, READING_SCALE_MIN, READING_SCALE_MAX, READING_SCALE_DEFAULT);');
  });

  it('reach the tokens through <html>, where :root defines them, and read as a percentage', () => {
    const apply = body('applyLayout');
    expect(apply).toContain("document.documentElement.style.setProperty('--ui-scale', String(ui.uiScale));");
    expect(apply).toContain("document.documentElement.style.setProperty('--reading-scale', String(ui.readingScale));");
    expect(apply).toContain('el.uiScaleOut.value = percent(ui.uiScale);');
    expect(apply).toContain('el.readingScaleOut.value = percent(ui.readingScale);');
    expect(main).toContain("const percent = (scale: number): string => `${Math.round(scale * 100)} %`;");
  });

  it('are settable from the command line, in the same breath as the widths', () => {
    expect(main).toContain("} else if (key === 'uiScale' || key === 'readingScale') {");
    expect(cli).toContain('textW, marginW, uiScale, readingScale');
  });

  it('keep a multiplier to two decimals, so a slider step never leaks binary noise into the state', () => {
    // The helper, read back the way it is written: clamp, then round to hundredths.
    expect(main).toContain(
      'const clampScale = (value: unknown, min: number, max: number, fallback: number): number => Math.round(clamp(value, min, max, fallback) * 100) / 100;',
    );
    const round = (v: number, min: number, max: number, fb: number): number => Math.round(Math.min(max, Math.max(min, Number(v) || fb)) * 100) / 100;
    expect(round(1.0500000000000003, 1, 1.4, 1)).toBe(1.05);
    expect(round(9, 1, 1.4, 1)).toBe(1.4);
    expect(round(0.5, 1, 1.4, 1)).toBe(1);
    expect(round(Number.NaN, 0.85, 1.6, 1)).toBe(1);
  });
});
