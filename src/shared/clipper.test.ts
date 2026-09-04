import { describe, expect, it } from 'vitest';
import { bookmarklet, clipPage, MAX_CLIP, parseClip } from './clipper';

describe('parseClip', () => {
  const token = 'a'.repeat(32);

  it('takes a clip that carries the token', () => {
    const r = parseClip(JSON.stringify({ token, title: ' A page ', text: ' words ' }), token);
    expect(r).toEqual({ ok: true, clip: { token, title: 'A page', text: 'words' } });
  });

  it('refuses a clip with the wrong token, or none', () => {
    expect(parseClip(JSON.stringify({ token: 'b'.repeat(32), text: 'x' }), token)).toMatchObject({ ok: false, status: 403 });
    expect(parseClip(JSON.stringify({ text: 'x' }), token)).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a body that is not a clip at all', () => {
    expect(parseClip('not json', token)).toMatchObject({ ok: false, status: 400 });
    expect(parseClip('null', token)).toMatchObject({ ok: false, status: 400 });
    expect(parseClip('[1,2]', token)).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a clip with nothing in it', () => {
    expect(parseClip(JSON.stringify({ token, text: '   ' }), token)).toMatchObject({ ok: false, status: 400 });
  });

  it('cuts a page that is longer than a page has any right to be', () => {
    const r = parseClip(JSON.stringify({ token, text: 'x'.repeat(MAX_CLIP + 500) }), token);
    expect(r.ok && r.clip.text.length).toBe(MAX_CLIP);
  });

  it('cuts an over-long title rather than storing it', () => {
    const r = parseClip(JSON.stringify({ token, title: 'T'.repeat(500), text: 'x' }), token);
    expect(r.ok && r.clip.title.length).toBe(200);
  });
});

describe('bookmarklet', () => {
  it('is a javascript: URL carrying this launch’s port and token', () => {
    const link = bookmarklet(51234, 'deadbeef');
    expect(link.startsWith('javascript:(')).toBe(true);
    expect(link).toContain('51234');
    expect(link).toContain('"deadbeef"');
  });

  it('carries the whole of the function, since that is all the browser gets', () => {
    // The function may use nothing from outside itself: anything it referenced
    // would simply be missing once it is a string in a bookmark.
    const source = String(clipPage);
    expect(bookmarklet(1, 'x')).toContain(source);
    expect(source).toContain('/clip');
    expect(source).not.toMatch(/\bimport\b/);
  });
});
