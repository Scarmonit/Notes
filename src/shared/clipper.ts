/**
 * The web clipper: a bookmarklet that turns the page you are reading into a
 * note.
 *
 * It is a bookmarklet rather than an extension because an extension is a
 * thing to install, keep signed and keep updated, and this is one button in
 * a bookmarks bar. What it sends goes to a small receiver the app opens on
 * localhost while it runs (main/clipper.ts) — not through a `notes://` link,
 * because an article is longer than a Windows command line.
 *
 * `clipPage` below is turned into the bookmarklet's source with `String()`,
 * so it may use nothing from outside itself: no imports, no helpers, no
 * constants from this file. Everything it needs is in its own body.
 */

/** The function the bookmarklet runs. Self-contained on purpose — see above. */
export function clipPage(port: number, token: string): void {
  const doc = document;

  /** The markdown for one element's children, walked in order. */
  const walk = (node: Node, lists: number): string => {
    let out = '';
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        out += (child.textContent ?? '').replace(/\s+/g, ' ');
        return;
      }
      if (child.nodeType !== 1) return;
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      // Only a list nests a list: counting every wrapper element indented a
      // clipped item by four spaces or more, which markdown reads as code.
      const inner = (): string => walk(el, tag === 'ul' || tag === 'ol' ? lists + 1 : lists);
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg' || tag === 'nav' || tag === 'footer') return;
      if (/^h[1-6]$/.test(tag)) out += `\n\n${'#'.repeat(Number(tag[1]))} ${inner().trim()}\n\n`;
      else if (tag === 'p') out += `\n\n${inner().trim()}\n\n`;
      else if (tag === 'br') out += '\n';
      else if (tag === 'hr') out += '\n\n---\n\n';
      else if (tag === 'strong' || tag === 'b') out += `**${inner().trim()}**`;
      else if (tag === 'em' || tag === 'i') out += `*${inner().trim()}*`;
      else if (tag === 'code' && el.closest('pre') === null) out += `\`${inner().trim()}\``;
      else if (tag === 'pre') out += `\n\n\`\`\`\n${(el.textContent ?? '').replace(/\n+$/, '')}\n\`\`\`\n\n`;
      else if (tag === 'blockquote') {
        out += `\n\n${inner()
          .trim()
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n')}\n\n`;
      } else if (tag === 'a') {
        const href = el.getAttribute('href') ?? '';
        const text = inner().trim();
        out += href && text ? `[${text}](${new URL(href, doc.baseURI).href})` : text;
      } else if (tag === 'img') {
        const src = el.getAttribute('src');
        out += src ? `\n\n![${el.getAttribute('alt') ?? ''}](${new URL(src, doc.baseURI).href})\n\n` : '';
      } else if (tag === 'li') {
        const ordered = el.parentElement?.tagName.toLowerCase() === 'ol';
        const at = Array.prototype.indexOf.call(el.parentElement?.children ?? [], el) + 1;
        const pad = '  '.repeat(Math.max(0, lists - 1));
        out += `\n${pad}${ordered ? `${at}.` : '-'} ${inner().trim()}`;
      } else if (tag === 'ul' || tag === 'ol') out += `\n${inner()}\n`;
      else out += inner();
    });
    return out;
  };

  /**
   * What the page is actually about: the selection when there is one, else
   * the biggest article-ish element, else the body. Not Readability — this
   * is one button, and a heuristic that picks <article> is right far more
   * often than it is wrong.
   */
  const chosen = (): HTMLElement => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const holder = doc.createElement('div');
      holder.appendChild(sel.getRangeAt(0).cloneContents());
      return holder;
    }
    const candidates = Array.prototype.slice.call(doc.querySelectorAll('article, main, [role="main"], .post, .entry-content, #content')) as HTMLElement[];
    let best: HTMLElement | null = null;
    for (const c of candidates) {
      if (!best || (c.textContent ?? '').length > (best.textContent ?? '').length) best = c;
    }
    return best && (best.textContent ?? '').length > 200 ? best : doc.body;
  };

  const title = (doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? doc.title ?? '').trim() || doc.location.hostname;
  const body = walk(chosen(), 0)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const text = `[${title}](${doc.location.href})\n\n${body}`;

  const say = (message: string): void => {
    const box = doc.createElement('div');
    box.textContent = message;
    box.setAttribute(
      'style',
      'position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:10px 14px;border-radius:6px;background:#121722;color:#e8e4dc;font:13px system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4)',
    );
    doc.body.appendChild(box);
    setTimeout(() => box.remove(), 3000);
  };

  // text/plain keeps this a simple request, so no preflight is needed and the
  // receiver can stay as small as it is.
  fetch(`http://127.0.0.1:${port}/clip`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token, title, text }) })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`Notes said ${r.status}`))))
    .then(() => say('Clipped to Notes'))
    .catch(() => say('Notes is not running, or the clipper is off'));
}

/** The bookmarklet a browser can be given, with this app's port and token in it. */
export function bookmarklet(port: number, token: string): string {
  return `javascript:(${String(clipPage)})(${port},${JSON.stringify(token)});void 0`;
}

/** What a clipper request must be for the app to act on it. */
export interface ClipRequest {
  token: string;
  title: string;
  text: string;
}

/** Reads a clip request, or says why it is not one. Never throws. */
export function parseClip(raw: string, token: string): { ok: true; clip: ClipRequest } | { ok: false; status: number; message: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, message: 'not json' };
  }
  if (!body || typeof body !== 'object') return { ok: false, status: 400, message: 'not a clip' };
  const clip = body as Partial<ClipRequest>;
  // The token is the whole of the security here: any page in the browser can
  // reach a port on localhost, so only the one holding this bookmarklet may
  // write a note.
  if (typeof clip.token !== 'string' || clip.token.length !== token.length || clip.token !== token) {
    return { ok: false, status: 403, message: 'wrong token' };
  }
  const text = typeof clip.text === 'string' ? clip.text.trim() : '';
  if (!text) return { ok: false, status: 400, message: 'nothing to clip' };
  const title = typeof clip.title === 'string' ? clip.title.trim().slice(0, 200) : '';
  return { ok: true, clip: { token, title, text: text.slice(0, MAX_CLIP) } };
}

/** As much of a page as is worth keeping: a long article, and no more. */
export const MAX_CLIP = 400_000;
