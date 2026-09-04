import { noteForLink, titleOf } from '../renderer/notes';
import { sectionOf } from '../renderer/outline';
import type { EmbedSource } from '../shared/markdown-core';
import type { Note } from '../shared/types';

/**
 * What `![[Note]]` and `![[Note#Heading]]` mean, given a notebook.
 *
 * The markdown core knows how to draw an embed but not where the words come
 * from; this is the one answer, so the preview, the PNG, the PDF, the HTML
 * export and the command line all embed the same thing. A link's target is
 * resolved exactly as a `[[link]]` is — by title, then by alias — because an
 * embed is a link that shows its note rather than pointing at it.
 */
export function embedsFrom(notes: Note[]): EmbedSource {
  return (target, section) => {
    const found = noteForLink(notes, target);
    if (!found) return null;
    const title = titleOf(found);
    if (!section) return { title, body: found.body };
    const part = sectionOf(found.body, section);
    return part === null ? null : { title, body: part };
  };
}
