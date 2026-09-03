import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dos from 'highlight.js/lib/languages/dos';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Syntax highlighting for fenced code blocks.
 *
 * The languages are registered one by one rather than taking highlight.js
 * whole: the app's script may only come from itself — no CDN — so everything
 * here is bundled, and a full build would be most of a megabyte of languages
 * nobody writes notes in. Each definition brings its own aliases, so `js`,
 * `sh`, `yml` and `ps1` are found without listing them.
 */
const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dos,
  go,
  ini,
  java,
  javascript,
  json,
  lua,
  markdown,
  php,
  powershell,
  python,
  ruby,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** The language a fence names, if it is one we can highlight. */
export function languageOf(info: string): string | null {
  const name = info.trim().split(/\s+/)[0].toLowerCase();
  if (!name) return null;
  const found = hljs.getLanguage(name);
  // The canonical name, so `js` and `javascript` end up as one class.
  return found ? (found.name ?? name).toLowerCase() : null;
}

/**
 * Code as HTML, highlighted when the fence names a language we know and
 * escaped plainly when it does not. A fence with no language is left alone:
 * guessing would colour a list of commands as if it were a program.
 */
export function highlightCode(code: string, info: string): { html: string; language: string | null } {
  const language = languageOf(info);
  if (!language) return { html: escapeHtml(code), language: null };
  try {
    return { html: hljs.highlight(code, { language, ignoreIllegals: true }).value, language };
  } catch {
    return { html: escapeHtml(code), language: null };
  }
}
