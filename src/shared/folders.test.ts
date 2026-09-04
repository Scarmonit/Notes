import { describe, expect, it } from 'vitest';
import {
  folderLabel,
  folderMatches,
  folderName,
  folderPath,
  folderTree,
  isSelfOrInside,
  joinFolder,
  normalizeFolder,
  parseFolder,
  ROOT_FOLDER,
  ROOT_LABEL,
  segmentProblem,
} from './folders';

/**
 * The vocabulary of a folder path. Everything above the disk agrees on one
 * spelling — root-relative, `/`-separated, the root written as nothing — and
 * on refusing a name rather than quietly turning it into another.
 */

describe('folder names', () => {
  it('refuses what Windows will not keep, and says which part is wrong', () => {
    expect(segmentProblem('Clients')).toBeNull();
    expect(segmentProblem('Q1 2026')).toBeNull();
    expect(segmentProblem('re-work')).toBeNull();
    expect(segmentProblem('')).toContain('needs a name');
    expect(segmentProblem('..')).toContain('not a name');
    expect(segmentProblem('a/b')).toContain('slash');
    expect(segmentProblem('a?b')).toContain('"?"');
    expect(segmentProblem('trailing ')).toContain('dot or a space');
    expect(segmentProblem('trailing.')).toContain('dot or a space');
    expect(segmentProblem('.hidden')).toContain('hides it');
    expect(segmentProblem('NUL')).toContain('reserves');
    expect(segmentProblem('com1.txt')).toContain('reserves');
    expect(segmentProblem('x'.repeat(81))).toContain('longer than 80');
  });

  it('never hands back a name nobody asked for', () => {
    // `fileNameFor` rewrites a title into something safe; a folder is not a
    // title, and being given "Q1 Q2" for "Q1?Q2" would be worse than a refusal.
    const bad = parseFolder('Work/Q1?Q2');
    expect('error' in bad && bad.error).toContain('"?"');
    expect('folder' in bad).toBe(false);
  });

  it('tidies the slashes without changing the names', () => {
    expect(normalizeFolder('/Work//Clients/')).toBe('Work/Clients');
    expect(normalizeFolder('Work\\Clients')).toBe('Work/Clients');
    expect(normalizeFolder('  ')).toBe(ROOT_FOLDER);
    expect(parseFolder(' Work / Clients ')).toEqual({ folder: 'Work/Clients' });
  });
});

describe('folder paths', () => {
  it('holds everything beneath it, and the root holds everything', () => {
    expect(folderMatches('Work/Clients/Hale', 'Work')).toBe(true);
    expect(folderMatches('Work', 'Work')).toBe(true);
    // Windows does not tell folders apart by case, so neither does this.
    expect(folderMatches('work/clients', 'Work')).toBe(true);
    expect(folderMatches('Workshop', 'Work')).toBe(false);
    expect(folderMatches(ROOT_FOLDER, ROOT_FOLDER)).toBe(true);
    expect(folderMatches('Work', ROOT_FOLDER)).toBe(true);
  });

  it('names the steps down to a folder, the way a tag names its levels', () => {
    expect(folderPath('Work/Clients/Hale')).toEqual(['Work', 'Work/Clients', 'Work/Clients/Hale']);
    expect(folderPath(ROOT_FOLDER)).toEqual([]);
  });

  it('reads the root as a place rather than as nothing', () => {
    expect(folderLabel(ROOT_FOLDER)).toBe(ROOT_LABEL);
    expect(folderLabel('Work/Clients')).toBe('Work / Clients');
    expect(folderName('Work/Clients')).toBe('Clients');
    expect(joinFolder(ROOT_FOLDER, 'Plan.md')).toBe('Plan.md');
    expect(joinFolder('Work', 'Plan.md')).toBe('Work/Plan.md');
  });

  it('knows a folder cannot be put inside itself', () => {
    expect(isSelfOrInside('Work', 'Work')).toBe(true);
    expect(isSelfOrInside('Work', 'Work/Clients')).toBe(true);
    expect(isSelfOrInside('Work', 'Archive')).toBe(false);
    // Everything is inside the root, but moving a folder to the root is fine.
    expect(isSelfOrInside(ROOT_FOLDER, 'Work')).toBe(false);
  });
});

describe('the folder tree', () => {
  it('counts a note towards every folder above it, as a nested tag does', () => {
    const tree = folderTree(['Work', 'Work/Clients', 'Work/Clients/Hale'], ['Work/Clients/Hale', 'Work/Clients/Hale', 'Work']);
    expect(tree.map((n) => n.folder)).toEqual(['Work']);
    expect(tree[0].count).toBe(3);
    expect(tree[0].own).toBe(1);
    const clients = tree[0].children[0];
    expect(clients.folder).toBe('Work/Clients');
    expect(clients.count).toBe(2);
    expect(clients.own).toBe(0);
    expect(clients.children[0].own).toBe(2);
  });

  it('keeps an empty folder, because a place with nothing in it is still a place', () => {
    const tree = folderTree(['Archive/2026'], []);
    expect(tree.map((n) => n.folder)).toEqual(['Archive']);
    expect(tree[0].count).toBe(0);
    expect(tree[0].children.map((n) => n.folder)).toEqual(['Archive/2026']);
  });

  it('sorts by name, so a folder does not move about as notes are added to it', () => {
    const tree = folderTree([], ['Zebra', 'Apple', 'Apple', 'Apple']);
    expect(tree.map((n) => n.label)).toEqual(['Apple', 'Zebra']);
  });

  it('finds a folder no directory was listed for, because a note is in it', () => {
    const tree = folderTree([], ['Work/Clients']);
    expect(tree[0].folder).toBe('Work');
    expect(tree[0].children[0].folder).toBe('Work/Clients');
  });
});
