import { describe, expect, it } from 'vitest';
import type { Note } from '../shared/types';
import {
  applyPlanTo,
  checkPlan,
  cleanTag,
  describePlan,
  headingLineOf,
  insert,
  invertPlan,
  placeBlock,
  planMerge,
  planMoveSection,
  planRefile,
  planRename,
  planTagRename,
  rewriteLinks,
  rewriteTags,
  sectionAround,
  type Plan,
} from './refactor';

const note = (id: string, body: string, title?: string): Note => (title === undefined ? { id, body, createdAt: 1, updatedAt: 1 } : { id, body, title, createdAt: 1, updatedAt: 1 });

const bodyOf = (plan: Plan, id: string): string | undefined => plan.writes.find((w) => w.id === id)?.after.body;

function must(r: ReturnType<typeof planRefile>): Plan {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.plan;
}

describe('insert (the command line append)', () => {
  it('appends as a paragraph, prepends, and continues a line', () => {
    expect(insert('a', 'b', {})).toBe('a\n\nb');
    expect(insert('', 'b', {})).toBe('b');
    expect(insert('a', 'b', { prepend: true })).toBe('b\n\na');
    expect(insert('a', 'b', { inline: true })).toBe('a b');
  });
  it('puts text at the end of a heading section, or makes the heading', () => {
    expect(insert('# A\n\nx\n\n# B\n\ny', 'z', { heading: 'A' })).toBe('# A\n\nx\n\nz\n\n# B\n\ny');
    expect(insert('# A\n\nx', 'z', { heading: 'b' })).toBe('# A\n\nx\n\n## b\n\nz');
    expect(insert('# A\n\nx\n\n# B', 'z', { heading: 'a', inline: true })).toBe('# A\n\nx z\n\n# B');
  });
});

describe('placeBlock', () => {
  const body = '# One\n\nfirst\n\n## Two\n\nsecond\n\n# Three\n\nthird';
  it('places under a heading by its line, before the next heading of any level', () => {
    expect(placeBlock(body, '- item', { line: 0 })).toBe('# One\n\nfirst\n\n- item\n\n## Two\n\nsecond\n\n# Three\n\nthird');
    expect(placeBlock(body, '- item', { line: 8 })).toBe('# One\n\nfirst\n\n## Two\n\nsecond\n\n# Three\n\nthird\n\n- item');
  });
  it('keeps the block as it is, indentation included', () => {
    expect(placeBlock('# A\n\nx', '  - nested\n    - deeper', { line: 0 })).toBe('# A\n\nx\n\n  - nested\n    - deeper');
  });
  it('goes to the top, the end, or under a new heading', () => {
    expect(placeBlock('a', 'b', 'top')).toBe('b\n\na');
    expect(placeBlock('a', 'b', 'end')).toBe('a\n\nb');
    expect(placeBlock('a', 'b', 'end', 'New')).toBe('a\n\n## New\n\nb');
    expect(placeBlock('', 'b', 'end', 'New')).toBe('## New\n\nb');
  });
  it('is null for a line that is not a heading', () => {
    expect(placeBlock(body, 'x', { line: 2 })).toBeNull();
    expect(placeBlock(body, 'x', { line: 99 })).toBeNull();
  });
  it('finds a heading by its words, first match', () => {
    expect(headingLineOf(body, 'two')).toBe(4);
    expect(headingLineOf('# A\n\n# A', 'A')).toBe(0);
    expect(headingLineOf(body, 'nope')).toBe(-1);
  });
});

describe('planRefile', () => {
  const inbox = note('in', 'call the bank\n\n- [ ] milk\n- [ ] eggs\n\nlast line', 'Inbox');
  const project = note('pr', '# Project\n\n## Ideas\n\n- old idea\n\n## Done\n\n- shipped');
  const notes = [inbox, project];

  it('moves lines under a heading, unchanged, and closes the gap they leave', () => {
    const plan = must(planRefile(notes, { from: 'in', first: 2, last: 3, to: 'pr', target: { line: 2 } }));
    expect(bodyOf(plan, 'in')).toBe('call the bank\n\nlast line');
    expect(bodyOf(plan, 'pr')).toBe('# Project\n\n## Ideas\n\n- old idea\n\n- [ ] milk\n- [ ] eggs\n\n## Done\n\n- shipped');
    expect(plan.summary).toEqual({ notes: 2, lines: 2 });
    expect(plan.touched).toEqual([
      { id: 'in', title: 'Inbox', changes: ['lines removed'] },
      { id: 'pr', title: 'Project', changes: ['text added'] },
    ]);
    expect(describePlan(plan)).toBe("Move 2 lines from 'Inbox' to 'Project' under 'Ideas'");
    expect(plan.writes[0].before.body).toBe(inbox.body);
  });
  it('moves to the top, the end, and under a heading it creates', () => {
    expect(bodyOf(must(planRefile(notes, { from: 'in', first: 0, last: 0, to: 'pr', target: 'top' })), 'pr')).toBe(`call the bank\n\n${project.body}`);
    expect(bodyOf(must(planRefile(notes, { from: 'in', first: 0, last: 0, to: 'pr', target: 'end' })), 'pr')).toBe(`${project.body}\n\ncall the bank`);
    const made = must(planRefile(notes, { from: 'in', first: 0, last: 0, to: 'pr', target: 'end', createHeading: 'Calls' }));
    expect(bodyOf(made, 'pr')).toBe(`${project.body}\n\n## Calls\n\ncall the bank`);
    expect(describePlan(made)).toBe("Move 1 line from 'Inbox' to 'Project' under a new heading 'Calls'");
  });
  it('moves the last lines out and leaves no trailing blank', () => {
    const plan = must(planRefile(notes, { from: 'in', first: 5, last: 5, to: 'pr', target: 'end' }));
    expect(bodyOf(plan, 'in')).toBe('call the bank\n\n- [ ] milk\n- [ ] eggs');
  });
  it('moves within one note: a target below the cut is found before the cut', () => {
    const n = note('a', '# A\n\n- move me\n\n# B\n\n- stays');
    const plan = must(planRefile([n], { from: 'a', first: 2, last: 2, to: 'a', target: { line: 4 } }));
    expect(plan.writes).toHaveLength(1);
    expect(bodyOf(plan, 'a')).toBe('# A\n\n# B\n\n- stays\n\n- move me');
    expect(plan.touched[0].changes).toEqual(['lines removed', 'text added']);
    expect(describePlan(plan)).toBe("Move 1 line to 'A' under 'B'");
  });
  it('moves within one note to a heading above the cut', () => {
    const n = note('a', '# A\n\n- stays\n\n# B\n\n- move me');
    const plan = must(planRefile([n], { from: 'a', first: 6, last: 6, to: 'a', target: { line: 0 } }));
    expect(bodyOf(plan, 'a')).toBe('# A\n\n- stays\n\n- move me\n\n# B');
  });
  it('refuses a heading inside the moved lines, blank lines, and missing notes or headings', () => {
    const n = note('a', '# A\n\n- x\n\n# B');
    expect(planRefile([n], { from: 'a', first: 0, last: 2, to: 'a', target: { line: 0 } })).toMatchObject({ ok: false, code: 'same_note' });
    expect(planRefile([n], { from: 'a', first: 1, last: 1, to: 'a', target: { line: 4 } })).toMatchObject({ ok: false, code: 'nothing_selected' });
    expect(planRefile([n], { from: 'a', first: 2, last: 9, to: 'a', target: 'end' })).toMatchObject({ ok: false, code: 'nothing_selected' });
    expect(planRefile([n], { from: 'zz', first: 0, last: 0, to: 'a', target: 'end' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(planRefile([n], { from: 'a', first: 0, last: 0, to: 'zz', target: 'end' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(planRefile(notes, { from: 'in', first: 0, last: 0, to: 'pr', target: { line: 1 } })).toMatchObject({ ok: false, code: 'heading_not_found' });
  });
  it('tells duplicate headings apart by their line', () => {
    const n = note('d', '# Log\n\n- one\n\n# Log\n\n- two');
    const plan = must(planRefile([inbox, n], { from: 'in', first: 0, last: 0, to: 'd', target: { line: 4 } }));
    expect(bodyOf(plan, 'd')).toBe('# Log\n\n- one\n\n# Log\n\n- two\n\ncall the bank');
  });
});

describe('planMoveSection', () => {
  const a = note('a', 'intro\n\n# One\n\ntext one\n\n## One point one\n\ndeeper\n\n# Two\n\ntext two\n');
  const b = note('b', '# B\n\nhere');

  it('finds the section around a line: heading through the next heading of the same or higher level', () => {
    expect(sectionAround(a.body, 4)).toEqual({ first: 2, last: 8, text: 'One' });
    expect(sectionAround(a.body, 6)).toEqual({ first: 6, last: 8, text: 'One point one' });
    expect(sectionAround(a.body, 12)).toEqual({ first: 10, last: 12, text: 'Two' });
    expect(sectionAround(a.body, 0)).toBeNull();
  });
  it('moves a heading and its subsections, levels untouched', () => {
    const plan = must(planMoveSection([a, b], { from: 'a', line: 3, to: 'b', target: { line: 0 } }));
    expect(plan.kind).toBe('move-section');
    expect(bodyOf(plan, 'a')).toBe('intro\n\n# Two\n\ntext two');
    expect(bodyOf(plan, 'b')).toBe('# B\n\nhere\n\n# One\n\ntext one\n\n## One point one\n\ndeeper');
    expect(describePlan(plan)).toBe("Move the section 'One' from 'intro' to 'B' under 'B'");
    expect(plan.summary.lines).toBe(7);
  });
  it('refuses a caret above the first heading, and a target inside the section', () => {
    expect(planMoveSection([a, b], { from: 'a', line: 0, to: 'b', target: 'end' })).toMatchObject({ ok: false, code: 'not_in_section' });
    expect(planMoveSection([a, b], { from: 'a', line: 3, to: 'a', target: { line: 6 } })).toMatchObject({ ok: false, code: 'same_note' });
  });
});

describe('rewriteLinks and planRename', () => {
  it('rewrites links case-insensitively, keeping aliases, and leaves others alone', () => {
    expect(rewriteLinks('see [[old note]] and [[Old Note|the old]] and [[Older]]', 'Old note', 'New')).toEqual({ body: 'see [[New]] and [[New|the old]] and [[Older]]', count: 2 });
    expect(rewriteLinks('none', 'x', 'y')).toEqual({ body: 'none', count: 0 });
  });
  it('renames and updates every link, the note itself included', () => {
    const notes = [note('a', 'I am [[Plan]] and link to [[plan]] myself', 'Plan'), note('b', 'see [[Plan|it]]'), note('c', 'no links'), note('d', 'link to [[Plane]]')];
    const plan = must(planRename(notes, { id: 'a', title: 'Roadmap', links: true }));
    expect(plan.writes.map((w) => w.id)).toEqual(['a', 'b']);
    expect(plan.writes[0].after).toEqual({ title: 'Roadmap', body: 'I am [[Roadmap]] and link to [[Roadmap]] myself' });
    expect(plan.writes[1].after.body).toBe('see [[Roadmap|it]]');
    expect(plan.summary).toEqual({ notes: 2, links: 3 });
    expect(plan.touched).toEqual([
      { id: 'a', title: 'Plan', changes: ['renamed', 'links rewritten'] },
      { id: 'b', title: 'see Plan|it', changes: ['links rewritten'] },
    ]);
    expect(describePlan(plan)).toBe("Rename 'Plan' to 'Roadmap' and update 3 links in 2 notes");
  });
  it('renames without links when asked, and refuses an unchanged or empty title', () => {
    const notes = [note('a', 'x', 'Plan'), note('b', '[[Plan]]')];
    const plan = must(planRename(notes, { id: 'a', title: 'Roadmap', links: false }));
    expect(plan.writes).toEqual([{ id: 'a', before: { body: 'x', title: 'Plan' }, after: { body: 'x', title: 'Roadmap' } }]);
    expect(describePlan(plan)).toBe("Rename 'Plan' to 'Roadmap'");
    expect(planRename(notes, { id: 'a', title: 'Plan', links: true })).toMatchObject({ ok: false, code: 'nothing_to_do' });
    expect(planRename(notes, { id: 'a', title: '  ', links: true })).toMatchObject({ ok: false, code: 'nothing_selected' });
    expect(planRename(notes, { id: 'zz', title: 'x', links: true })).toMatchObject({ ok: false, code: 'not_found' });
  });
  it('gives a title to a note that had only a first line, pointing links at it', () => {
    const notes = [note('a', '# Draft\n\nwords'), note('b', '[[draft]]')];
    const plan = must(planRename(notes, { id: 'a', title: 'Final', links: true }));
    expect(plan.writes[0].after).toEqual({ title: 'Final', body: '# Draft\n\nwords' });
    expect(plan.writes[1].after.body).toBe('[[Final]]');
  });
});

describe('rewriteTags and planTagRename', () => {
  it('rewrites whole tags and nested ones, not words or URLs', () => {
    const body = '#wow and #wow/commands, #wowza, http://x.com/#wow, code#wow, #WOW';
    expect(rewriteTags(body, 'wow', 'games')).toEqual({ body: '#games and #games/commands, #wowza, http://x.com/#wow, code#wow, #games', count: 3 });
  });
  it('renames across notes and counts', () => {
    const notes = [note('a', 'x #old'), note('b', '#old/kid'), note('c', '#other')];
    const plan = must(planTagRename(notes, { from: '#Old', to: 'new' }));
    expect(plan.writes.map((w) => w.after.body)).toEqual(['x #new', '#new/kid']);
    expect(plan.summary).toEqual({ notes: 2, tags: 2 });
    expect(plan.touched[0].changes).toEqual(['tags rewritten']);
    expect(describePlan(plan)).toBe('Rename #old to #new in 2 notes (2 tags)');
  });
  it('refuses bad names, the same name, and a tag nobody carries', () => {
    const notes = [note('a', '#old')];
    expect(planTagRename(notes, { from: 'old', to: 'two words' })).toMatchObject({ ok: false, code: 'bad_tag' });
    expect(planTagRename(notes, { from: 'old', to: '1st' })).toMatchObject({ ok: false, code: 'bad_tag' });
    expect(planTagRename(notes, { from: 'old', to: 'OLD' })).toMatchObject({ ok: false, code: 'nothing_to_do' });
    expect(planTagRename(notes, { from: 'gone', to: 'new' })).toMatchObject({ ok: false, code: 'nothing_to_do' });
    expect(cleanTag(' #A/B ')).toBe('a/b');
  });
});

describe('planMerge', () => {
  it('appends the source under a heading of its title, retargets links, and trashes it', () => {
    const notes = [note('s', 'the dup\n\nwords', 'Dup'), note('t', '# Plan\n\nkeep', 'Plan'), note('o', 'see [[Dup]] and [[Plan]]')];
    const plan = must(planMerge(notes, { source: 's', into: 't' }));
    expect(bodyOf(plan, 't')).toBe('# Plan\n\nkeep\n\n## Dup\n\nthe dup\n\nwords');
    expect(bodyOf(plan, 'o')).toBe('see [[Plan]] and [[Plan]]');
    expect(plan.trash).toEqual([{ id: 's', before: { body: 'the dup\n\nwords', title: 'Dup' } }]);
    expect(plan.writes.map((w) => w.id)).toEqual(['t', 'o']);
    expect(plan.select).toBe('t');
    expect(plan.summary).toEqual({ notes: 3, links: 1 });
    expect(plan.touched).toEqual([
      { id: 't', title: 'Plan', changes: ['text added'] },
      { id: 'o', title: 'see Dup and Plan', changes: ['links rewritten'] },
      { id: 's', title: 'Dup', changes: ['trashed'] },
    ]);
    expect(describePlan(plan)).toBe("Merge 'Dup' into 'Plan', updating 1 link in 1 note, and move 'Dup' to the trash");
  });
  it('reuses a leading heading equal to the title instead of adding one, and rewrites links inside the merged text', () => {
    const notes = [note('s', '# Dup\n\nwords and [[Dup]]'), note('t', 'keep', 'Plan')];
    const plan = must(planMerge(notes, { source: 's', into: 't' }));
    expect(bodyOf(plan, 't')).toBe('keep\n\n# Dup\n\nwords and [[Plan]]');
    expect(plan.touched[0].changes).toEqual(['text added', 'links rewritten']);
  });
  it('merges an empty note as just a trash and link move', () => {
    const notes = [note('s', '', 'Empty'), note('t', 'keep', 'Plan')];
    const plan = must(planMerge(notes, { source: 's', into: 't' }));
    expect(plan.writes).toEqual([]);
    expect(plan.trash[0].id).toBe('s');
  });
  it('refuses merging a note into itself or a missing note', () => {
    const notes = [note('s', 'x')];
    expect(planMerge(notes, { source: 's', into: 's' })).toMatchObject({ ok: false, code: 'same_note' });
    expect(planMerge(notes, { source: 's', into: 'zz' })).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('checkPlan, applyPlanTo and invertPlan', () => {
  const notes = [note('s', 'dup', 'Dup'), note('t', 'keep', 'Plan'), note('o', '[[Dup]]')];
  const plan = must(planMerge(notes, { source: 's', into: 't' }));

  it('passes while nothing moved, and is stale once any touched note, the source included, changes', () => {
    expect(checkPlan(plan, notes)).toEqual({ ok: true });
    expect(checkPlan(plan, [note('s', 'dup edited', 'Dup'), notes[1], notes[2]])).toMatchObject({ ok: false, code: 'stale' });
    expect(checkPlan(plan, [notes[0], note('t', 'keep', 'Renamed'), notes[2]])).toMatchObject({ ok: false, code: 'stale' });
    expect(checkPlan(plan, [notes[0], notes[1]])).toMatchObject({ ok: false, code: 'stale' });
    expect(checkPlan(plan, notes.slice(1))).toMatchObject({ ok: false, code: 'stale' });
  });
  it('applies to a list: writes replace, trashed drop, timestamps move', () => {
    const after = applyPlanTo(plan, notes, 99);
    expect(after.map((n) => n.id)).toEqual(['t', 'o']);
    expect(after[0]).toMatchObject({ body: 'keep\n\n## Dup\n\ndup', title: 'Plan', updatedAt: 99 });
    expect(after[1]).toMatchObject({ body: '[[Plan]]', updatedAt: 99 });
  });
  it('inverts: writes swap, the trashed note is to be restored, and inverting twice is the plan again', () => {
    const inverse = invertPlan(plan);
    expect(inverse.writes[0]).toEqual({ id: 't', before: plan.writes[0].after, after: plan.writes[0].before });
    expect(inverse.trash).toEqual([]);
    expect(inverse.restore).toEqual(plan.trash);
    expect(checkPlan(inverse, applyPlanTo(plan, notes))).toEqual({ ok: true });
    expect(checkPlan(inverse, notes)).toMatchObject({ ok: false, code: 'stale' });
    expect(invertPlan(inverse)).toEqual(plan);
  });
  it('drops an explicit title when the plan clears it', () => {
    const p = must(planRename([note('a', 'x', 'Old')], { id: 'a', title: 'New', links: false }));
    const back = invertPlan(p);
    expect(applyPlanTo(back, applyPlanTo(p, [note('a', 'x', 'Old')]))[0].title).toBe('Old');
  });
});

describe('the fixes of 0.15.1', () => {
  it('places lines under a heading above the gap when the note starts with a blank line', () => {
    // The leading blank line is stripped by the cut; a target above the gap moves up by that alone.
    const a = note('a', '\n# A\ntext\n# B\nmore');
    const found = must(planRefile([a], { from: 'a', first: 4, last: 4, to: 'a', target: { line: 1 } }));
    expect(found.writes[0].after.body).toBe('# A\ntext\n\nmore\n\n# B');
    const b = note('b', '\n# A\n# B\ntext\n# C\nmore');
    const under = must(planRefile([b], { from: 'b', first: 5, last: 5, to: 'b', target: { line: 1 } }));
    expect(under.writes[0].after.body).toBe('# A\n\nmore\n\n# B\ntext\n# C');
    const section = note('c', '\n# A\n\n# B\ntext');
    expect(planMoveSection([section], { from: 'c', line: 3, to: 'c', target: { line: 1 } }).ok).toBe(true);
  });
  it('appends under a heading without touching blank lines elsewhere in the note', () => {
    const body = '# A\nx\n\n# B\n```\na\n\n\nb\n```';
    expect(insert(body, 'new', { heading: 'A' })).toBe('# A\nx\n\nnew\n\n# B\n```\na\n\n\nb\n```');
    expect(insert('# A\n\nx\n\n\n\n# B\n\ny', 'z', { heading: 'A' })).toBe('# A\n\nx\n\nz\n\n# B\n\ny');
  });
});
