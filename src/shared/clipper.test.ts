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

describe('clipPage, run against a page', () => {
  /** Runs the bookmarklet body against the current document and returns what it posted. */
  async function clip(html: string): Promise<{ title: string; text: string }> {
    document.body.innerHTML = html;
    let sent = '';
    const real = globalThis.fetch;
    globalThis.fetch = ((_url: string, init: { body: string }) => {
      sent = init.body;
      return Promise.resolve({ ok: true, text: () => Promise.resolve('clipped') });
    }) as unknown as typeof globalThis.fetch;
    try {
      clipPage(1234, 'tok');
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      globalThis.fetch = real;
    }
    return JSON.parse(sent) as { title: string; text: string };
  }

  it('indents a list by how deep the list is, not by how deep the page is', async () => {
    // The walker counted every element it descended through, so a list a few
    // wrapper divs down came out indented four spaces or more -- which
    // markdown reads as a code block rather than a list.
    const { text } = await clip('<div><div><section><ul><li>One</li><li>Two</li></ul></section></div></div>');
    expect(text).toContain('\n- One');
    expect(text).toContain('\n- Two');
    expect(text).not.toMatch(/\n {2,}- One/);
  });

  it('still indents a list that is nested inside another list', async () => {
    const { text } = await clip('<ul><li>Top<ul><li>Under</li></ul></li></ul>');
    expect(text).toMatch(/\n {2}- Under/);
  });
});
