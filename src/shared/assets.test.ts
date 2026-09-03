import { describe, expect, it } from 'vitest';
import { assetNameFromUrl, assetRefs, assetUrl, exportFileName, isSafeAssetName, rewriteAssetLinks } from './assets';

describe('isSafeAssetName', () => {
  it('accepts random hex plus an image extension', () => {
    expect(isSafeAssetName('0123abcd4567ef89.png')).toBe(true);
    expect(isSafeAssetName('deadbeef.JPG')).toBe(true);
    expect(isSafeAssetName('deadbeef.webp')).toBe(true);
  });
  it('rejects paths, other types and odd names', () => {
    expect(isSafeAssetName('../notes.json')).toBe(false);
    expect(isSafeAssetName('deadbeef.exe')).toBe(false);
    expect(isSafeAssetName('deadbeef')).toBe(false);
    expect(isSafeAssetName('C:\\x\\deadbeef.png')).toBe(false);
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
