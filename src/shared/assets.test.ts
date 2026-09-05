import { describe, expect, it } from 'vitest';
import { assetKind, assetNameFromUrl, assetRefs, assetUrl, attachmentLinkAt, attachmentLinksIn, attachmentMarkdown, canOpenAsset, exportFileName, formatSize, isImageAsset, isSafeAssetName, rewriteAssetLinks } from './assets';

describe('isSafeAssetName', () => {
  it('accepts random hex plus an image extension', () => {
    expect(isSafeAssetName('0123abcd4567ef89.png')).toBe(true);
    expect(isSafeAssetName('deadbeef.JPG')).toBe(true);
    expect(isSafeAssetName('deadbeef.webp')).toBe(true);
  });
  it('rejects paths and odd names, and since 0.28 accepts any plain extension the store may have chosen', () => {
    expect(isSafeAssetName('../notes.json')).toBe(false);
    expect(isSafeAssetName('deadbeef')).toBe(false);
    expect(isSafeAssetName('C:\\x\\deadbeef.png')).toBe(false);
    expect(isSafeAssetName('deadbeef.tar.gz')).toBe(false);
    expect(isSafeAssetName('deadbeef.exe')).toBe(true);
    expect(isSafeAssetName('0123456789abcdef.pdf')).toBe(true);
    expect(isSafeAssetName('0123456789abcdef.bin')).toBe(true);
  });
});

describe('kinds of attachment', () => {
  it('tells a picture, a PDF, sound and video from a file by the extension the store chose', () => {
    expect(assetKind('deadbeef.png')).toBe('image');
    expect(assetKind('deadbeef.PDF')).toBe('pdf');
    expect(assetKind('deadbeef.mp3')).toBe('audio');
    expect(assetKind('deadbeef.webm')).toBe('video');
    expect(assetKind('deadbeef.xlsx')).toBe('file');
    expect(isImageAsset('deadbeef.jpg')).toBe(true);
    expect(isImageAsset('deadbeef.pdf')).toBe(false);
  });

  it('opens documents and media in their own apps, never an executable or a script', () => {
    for (const ext of ['pdf', 'mp3', 'mp4', 'docx', 'xlsx', 'csv', 'md', 'txt', 'png']) expect(canOpenAsset(`deadbeef.${ext}`), ext).toBe(true);
    for (const ext of ['exe', 'bat', 'js', 'ps1', 'zip', 'bin', 'msi', 'lnk']) expect(canOpenAsset(`deadbeef.${ext}`), ext).toBe(false);
    expect(canOpenAsset('../deadbeef.pdf')).toBe(false);
  });

  it('writes a link with the file’s own name as the words, escaped, and finds it again on a line', () => {
    expect(attachmentMarkdown('0123456789abcdef.pdf', 'Q3 report [final].pdf')).toBe('[Q3 report \\[final\\].pdf](note-asset://0123456789abcdef.pdf)');
    expect(attachmentMarkdown('0123456789abcdef.pdf', '')).toBe('[0123456789abcdef.pdf](note-asset://0123456789abcdef.pdf)');
    const line = 'see [report.pdf](note-asset://0123456789abcdef.pdf) and ![cat](note-asset://fedcba9876543210.png)';
    expect(attachmentLinksIn(line).map((l) => [l.name, l.text, l.start])).toEqual([
      ['0123456789abcdef.pdf', 'report.pdf', 4],
      ['fedcba9876543210.png', 'cat', 56],
    ]);
    expect(attachmentLinkAt(line, 10)?.name).toBe('0123456789abcdef.pdf');
    expect(attachmentLinkAt(line, 2)).toBeNull();
  });

  it('reads a size the way a person would', () => {
    expect(formatSize(12)).toBe('12 B');
    expect(formatSize(640 * 1024)).toBe('640 KB');
    expect(formatSize(1.25 * 1024 * 1024)).toBe('1.3 MB');
    expect(formatSize(40 * 1024 * 1024)).toBe('40 MB');
  });
});

describe('assetNameFromUrl', () => {
  it('extracts the name and tolerates trailing slashes and queries', () => {
    expect(assetNameFromUrl('note-asset://deadbeef.png')).toBe('deadbeef.png');
    expect(assetNameFromUrl('note-asset://deadbeef.png/')).toBe('deadbeef.png');
    expect(assetNameFromUrl('note-asset://deadbeef.png?x=1#y')).toBe('deadbeef.png');
  });
  it('refuses traversal, other schemes and malformed encoding', () => {
    expect(assetNameFromUrl('note-asset://../notes.json')).toBeNull();
    expect(assetNameFromUrl('note-asset://%2e%2e/notes.json')).toBeNull();
    expect(assetNameFromUrl('note-asset://deadbeef.png/../x.png')).toBeNull();
    expect(assetNameFromUrl('https://deadbeef.png')).toBeNull();
    expect(assetNameFromUrl('note-asset://%E0%A4%A')).toBeNull();
  });
});

describe('assetRefs / rewriteAssetLinks', () => {
  const body = 'Look:\n\n![a](note-asset://aaaaaaaa.png)\n\n![b](note-asset://bbbbbbbb.jpg) and again ![a](note-asset://aaaaaaaa.png)\n\n![bad](note-asset://../x.png)';
  it('lists unique safe names in order', () => {
    expect(assetRefs(body)).toEqual(['aaaaaaaa.png', 'bbbbbbbb.jpg']);
  });
  it('rewrites every safe reference and leaves others alone', () => {
    const out = rewriteAssetLinks(body, (name) => `Note_files/${name}`);
    expect(out).toContain('![a](Note_files/aaaaaaaa.png)');
    expect(out).toContain('![b](Note_files/bbbbbbbb.jpg)');
    expect(out).toContain('note-asset://../x.png');
    expect(out.match(/Note_files/g)).toHaveLength(3);
  });
  it('round-trips through assetUrl', () => {
    expect(assetRefs(`![x](${assetUrl('cafebabe.gif')})`)).toEqual(['cafebabe.gif']);
  });
});

describe('exportFileName', () => {
  it('strips characters Windows forbids and trailing dots', () => {
    expect(exportFileName('Plan: Q3 / "final"?', 'md')).toBe('Plan Q3  final.md'.replace('  ', ' '));
    expect(exportFileName('Ends with dots...', 'txt')).toBe('Ends with dots.txt');
  });
  it('falls back to Note and caps the length', () => {
    expect(exportFileName('', 'png')).toBe('Note.png');
    expect(exportFileName('???', 'png')).toBe('Note.png');
    expect(exportFileName('x'.repeat(200), 'md').length).toBe(83);
  });
});
