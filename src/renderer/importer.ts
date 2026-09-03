/**
 * Turning a markdown or text file into a note. Files arrive two ways — dropped
 * onto the window, or chosen from the Import dialog — and both land here, so a
 * dropped file and a picked one always become the same note.
 */

const TEXT_FILE = /\.(?:md|markdown|mdown|mkd|txt|text)$/i;

export function isTextFile(name: string): boolean {
  return TEXT_FILE.test(name);
}

export interface Imported {
  /** The explicit title the note should carry, or '' to let the body speak. */
  title: string;
  body: string;
}

/** The file name without its folder or extension. */
function baseName(name: string): string {
  const file = name.split(/[\\/]/).pop() ?? name;
  return file.replace(TEXT_FILE, '').trim();
}

/**
 * A file becomes one note. A leading `# Heading` is lifted out as the title,
 * the way the app's own markdown export writes it, so a note exported and
 * imported again comes back as it was. Without one, the file name is the title.
 */
export function noteFromFile(name: string, text: string): Imported {
  // Windows line endings and a BOM would otherwise become part of the text.
  const body = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = body.split('\n');
  let first = 0;
  while (first < lines.length && lines[first].trim() === '') first++;
  const heading = /^#\s+(.+?)\s*$/.exec(lines[first] ?? '');
  if (heading) {
    let rest = first + 1;
    while (rest < lines.length && lines[rest].trim() === '') rest++;
    return { title: heading[1], body: lines.slice(rest).join('\n').replace(/\s+$/, '') };
  }
  return { title: baseName(name), body: body.replace(/^\n+/, '').replace(/\s+$/, '') };
}
