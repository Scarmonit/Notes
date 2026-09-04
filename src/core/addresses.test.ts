import { describe, expect, it } from 'vitest';
import { blockFallout, falloutSentence, planBlockId, planRefile, rewriteLinks } from './refactor';
import { embedsFrom } from './embeds';
import { formatLinkAddress, parseLinkAddress } from '../renderer/notes';
import { withoutMarkers } from './blocks';
import { parseMarkdown } from '../shared/markdown-core';
import type { Note } from '../shared/types';

const note = (id: string, title: string, body: string, folder = ''): Note => ({ id, body, createdAt: 1, updatedAt: 2, title, folder, file: `${title}.md` });

describe('parseLinkAddress', () => {
  it('splits the alias first, then the address at its first #', () => {
    expect(parseLinkAddress('Plan')).toEqual({ target: 'Plan' });
    expect(parseLinkAddress('Plan|the plan')).toEqual({ target: 'Plan', alias: 'the plan' });
    expect(parseLinkAddress('Plan#Decision')).toEqual({ target: 'Plan', heading: 'Decision' });
    expect(parseLinkAddress('Plan#^k3n9dq')).toEqual({ target: 'Plan', block: 'k3n9dq' });
    expect(parseLinkAddress('Work/Plan#^k3n9dq|as this')).toEqual({ target: 'Work/Plan', block: 'k3n9dq', alias: 'as this' });
  });

  it('reads an empty name as this note, for a local heading or block', () => {
    expect(parseLinkAddress('#^k3n9dq')).toEqual({ target: '', block: 'k3n9dq' });
    expect(parseLinkAddress('#Decision')).toEqual({ target: '', heading: 'Decision' });
  });

  it('gives the block reading to #^ and the heading reading to everything else', () => {
    // A heading whose words start with a caret cannot be addressed that way,
    // and that is the trade: one spelling means a block, always.
    expect(parseLinkAddress('Plan#^weird')).toEqual({ target: 'Plan', block: 'weird' });
    expect(parseLinkAddress('Plan#A # in a heading')).toEqual({ target: 'Plan', heading: 'A # in a heading' });
  });

  it('puts an address back together exactly as it came apart', () => {
    for (const inner of ['Plan', 'Plan|the plan', 'Plan#Decision', 'Plan#^k3n9dq', 'Work/Plan#^k3n9dq|as this', '#^k3n9dq', '#Decision']) {
      expect(formatLinkAddress(parseLinkAddress(inner)), inner).toBe(inner);
    }
  });
});

describe('rewriteLinks', () => {
  it('moves the note a link names and leaves its fragment and alias byte for byte', () => {
    const body = 'see [[Plan#^k3n9dq|the decision]] and [[Plan#Decision]] and [[Plan]]';
    const { body: next, count } = rewriteLinks(body, 'Plan', 'Work/Plan');
    expect(count).toBe(3);
    expect(next).toBe('see [[Work/Plan#^k3n9dq|the decision]] and [[Work/Plan#Decision]] and [[Work/Plan]]');
  });

  it('leaves a link to another note alone', () => {
    expect(rewriteLinks('[[Other#^abc123]]', 'Plan', 'Work/Plan').count).toBe(0);
  });
});

describe('embedding a block', () => {
  const notes = [note('a', 'Plan', 'Intro.\n\n- Decision ^k3n9dq\n  - detail\n\n## Head\n\nUnder it.'), note('b', 'Here', 'Local. ^loc001')];

  it('embeds the block an address names, subtree and all', () => {
    const source = embedsFrom(notes);
    expect(source('Plan', '^k3n9dq')).toEqual({ title: 'Plan', body: '- Decision\n  - detail' });
  });

  it('embeds a heading’s section the way it always did', () => {
    expect(embedsFrom(notes)('Plan', 'Head')).toEqual({ title: 'Plan', body: '## Head\n\nUnder it.' });
  });

  it('answers nothing for a block that is not there', () => {
    expect(embedsFrom(notes)('Plan', '^missing')).toBe(null);
  });

  it('reads an empty name as the note the embed is written in', () => {
    expect(embedsFrom(notes, notes[1])('', '^loc001')).toEqual({ title: 'Here', body: 'Local.' });
    // Without a note to stand in for it, there is nothing to embed.
    expect(embedsFrom(notes)('', '^loc001')).toBe(null);
  });

  it('draws a block embed through the same door as every other one', () => {
    const html = parseMarkdown('![[Plan#^k3n9dq]]\n', embedsFrom(notes));
    expect(html).toContain('Decision');
    // The caption cites the address, the way it names a heading it embedded.
    expect(html).toContain('Plan · ^k3n9dq');
    // The marker is the address, not the words: it is not in the text drawn.
    expect(html).not.toContain('Decision ^k3n9dq');
  });
});

describe('markers in rendered output', () => {
  it('takes an address off every line that is read rather than edited', () => {
    expect(withoutMarkers('A paragraph. ^abc123\n\n- item ^def456')).toBe('A paragraph.\n\n- item');
  });

  it('takes a standalone marker line away with it', () => {
    expect(withoutMarkers('| a |\n| --- |\n^tbl001\n\nafter')).toBe('| a |\n| --- |\n\nafter');
  });

  it('leaves one inside a fence exactly as it was typed', () => {
    const body = '```\nexample. ^abc123\n```';
    expect(withoutMarkers(body)).toBe(body);
    expect(parseMarkdown(body)).toContain('^abc123');
  });

  it('keeps the address out of the preview but the words in it', () => {
    const html = parseMarkdown('The decision. ^k3n9dq\n');
    expect(html).toContain('The decision.');
    expect(html).not.toContain('k3n9dq');
  });
});

describe('planBlockId', () => {
  const notes = [note('a', 'Plan', 'One.\n\nTwo. ^has001')];

  it('writes an address onto the block at a line, as one undoable step', () => {
    const planned = planBlockId(notes, { id: 'a', line: 0, blockId: 'new001' });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.writes[0].after.body).toBe('One. ^new001\n\nTwo. ^has001');
    expect(planned.plan.touched[0].changes).toEqual(['address added']);
  });

  it('refuses a block that already has one, and a line that is not a block', () => {
    expect(planBlockId(notes, { id: 'a', line: 2, blockId: 'x' })).toMatchObject({ ok: false, code: 'nothing_to_do' });
    expect(planBlockId(notes, { id: 'a', line: 1, blockId: 'x' })).toMatchObject({ ok: false, code: 'nothing_selected' });
  });
});

describe('what a move is about to break', () => {
  const source = note('a', 'Plan', 'Keep this.\n\nMove me. ^k3n9dq');
  const target = note('b', 'Other', 'Nothing here yet.');
  const pointer = note('c', 'Elsewhere', 'see [[Plan#^k3n9dq]] and [[Plan#^k3n9dq|again]]');

  it('counts the links that would be left pointing at nothing', () => {
    const planned = planRefile([source, target, pointer], { from: 'a', first: 2, last: 2, to: 'b', target: 'end' });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const fallout = blockFallout(planned.plan, [source, target, pointer]);
    expect(fallout).toMatchObject({ lost: ['k3n9dq'], links: 2, collisions: [] });
    expect(falloutSentence(fallout!)).toContain('break 2 block links');
  });

  it('names an address that would become ambiguous where it lands', () => {
    const held = note('b', 'Other', 'Already. ^k3n9dq');
    const planned = planRefile([source, held], { from: 'a', first: 2, last: 2, to: 'b', target: 'end' });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const fallout = blockFallout(planned.plan, [source, held]);
    expect(fallout?.collisions).toEqual(['k3n9dq']);
    expect(falloutSentence(fallout!)).toContain('ambiguous');
  });

  it('says nothing at all when the text carries no address', () => {
    const plain = note('a', 'Plan', 'Keep this.\n\nMove me.');
    const planned = planRefile([plain, target], { from: 'a', first: 2, last: 2, to: 'b', target: 'end' });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(blockFallout(planned.plan, [plain, target])).toBe(null);
  });
});
