import { assetNameFromUrl, assetUrl } from '../shared/assets';

/**
 * The editor is a contenteditable surface, not a textarea, so attached images
 * can render as actual pictures inline where they were pasted. The note is
 * still stored and exported as markdown: this module maps between the markdown
 * body and the DOM.
 *
 * Only our own attachments (note-asset:// images) become picture chips. Every
 * other character, including all other markdown syntax, stays literal text,
 * so the surface reads as a plain writing area with images in it.
 */

// Matches an attached image: ![alt](note-asset://<hex>.<ext>)
const IMAGE_MD = /!\[([^\]]*)\]\(note-asset:\/\/([a-f0-9]{8,32}\.(?:png|jpe?g|gif|webp|bmp))\)/gi;

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The HTML for one inline image chip, for insertion at the caret. */
export function imageChipHtml(name: string, alt: string): string {
  const a = escapeAttr(alt || 'image');
  return `<img class="inline-img" contenteditable="false" draggable="false" src="${assetUrl(name)}" alt="${a}" data-asset="${name}" data-alt="${a}">`;
}

function makeChip(name: string, alt: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'inline-img';
  img.contentEditable = 'false';
  img.draggable = false;
  img.src = assetUrl(name);
  img.alt = alt || 'image';
  img.dataset.asset = name;
  img.dataset.alt = alt || 'image';
  return img;
}

/** Replaces the editor's contents with the DOM for `body`. Call on note switch. */
export function renderEditor(root: HTMLElement, body: string): void {
  root.replaceChildren();
  IMAGE_MD.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = IMAGE_MD.exec(body)) !== null) {
    if (match.index > last) root.appendChild(document.createTextNode(body.slice(last, match.index)));
    root.appendChild(makeChip(match[2], match[1]));
    last = match.index + match[0].length;
  }
  if (last < body.length) root.appendChild(document.createTextNode(body.slice(last)));
  markEmpty(root);
}

/** Reads the editor's DOM back out as a markdown body. */
export function serializeEditor(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? '';
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const elm = child as HTMLElement;
      switch (elm.tagName) {
        case 'IMG': {
          const name = elm.dataset.asset ?? assetNameFromUrl(elm.getAttribute('src') ?? '');
          if (name) out += `![${elm.dataset.alt ?? elm.getAttribute('alt') ?? 'image'}](${assetUrl(name)})`;
          break;
        }
        case 'BR':
          out += '\n';
          break;
        case 'DIV':
        case 'P':
          // A browser-created line: start it on a new line, then descend.
          if (out.length > 0 && !out.endsWith('\n')) out += '\n';
          walk(elm);
          break;
        default:
          walk(elm);
      }
    });
  };
  walk(root);
  // A contenteditable keeps a trailing <br> to make the last line visible;
  // that shows up as one extra newline, which is not part of the text.
  return out.replace(/\n$/, '');
}

/** Toggles the empty flag that drives the placeholder. */
export function markEmpty(root: HTMLElement): void {
  root.classList.toggle('is-empty', serializeEditor(root) === '');
}
