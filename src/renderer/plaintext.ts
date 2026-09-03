import { marked, type Token, type Tokens } from 'marked';

/**
 * Markdown to readable plain text for the .txt export: headings and paragraphs
 * become lines, list markers and quote marks stay, emphasis goes, links read
 * as "text (url)" and images as "[image: alt]".
 */

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);

export function markdownToText(markdown: string): string {
  const tokens = marked.lexer(markdown, { gfm: true, breaks: true });
  const text = blocks(tokens, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? `${text}\n` : '';
}

type WithRaw = { raw?: string };

function inline(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  return tokens
    .map((t): string => {
      switch (t.type) {
        case 'text': {
          const tt = t as Tokens.Text;
          return tt.tokens && tt.tokens.length > 0 ? inline(tt.tokens) : decode(tt.text);
        }
        case 'escape':
          return (t as Tokens.Escape).text;
        case 'strong':
        case 'em':
        case 'del':
          return inline((t as Tokens.Strong).tokens);
        case 'codespan':
          return decode((t as Tokens.Codespan).text);
        case 'link': {
          const link = t as Tokens.Link;
          const label = inline(link.tokens);
          return label && label !== link.href ? `${label} (${link.href})` : link.href;
        }
        case 'image': {
          const image = t as Tokens.Image;
          return image.text ? `[image: ${image.text}]` : '[image]';
        }
        case 'br':
          return '\n';
        case 'html':
          return htmlImage((t as WithRaw).raw ?? '');
        default:
          return decode((t as WithRaw).raw ?? '');
      }
    })
    .join('');
}

/** "[image: alt]" for an <img> tag, or nothing for any other HTML. */
function htmlImage(raw: string): string {
  const tag = /<img\b([^<>]*)>/i.exec(raw);
  if (!tag) return '';
  const alt = /(?:^|\s)alt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag[1]);
  const text = decode(alt?.[1] ?? alt?.[2] ?? alt?.[3] ?? '');
  return text ? `[image: ${text}]` : '[image]';
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line ? prefix + line : line))
    .join('\n');
}

function blocks(tokens: Token[], indent: string): string {
  const out: string[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break;
      case 'html': {
        // A sized attachment is an <img> tag in the body; other HTML has no text form.
        const text = htmlImage((t as WithRaw).raw ?? '');
        if (text) out.push(`${indent}${text}

`);
        break;
      }
      case 'heading':
        out.push(`${indent}${inline((t as Tokens.Heading).tokens)}\n\n`);
        break;
      case 'paragraph':
        out.push(`${prefixLines(inline((t as Tokens.Paragraph).tokens), indent)}\n\n`);
        break;
      case 'text': {
        const tt = t as Tokens.Text;
        const text = tt.tokens && tt.tokens.length > 0 ? inline(tt.tokens) : decode(tt.text);
        out.push(`${prefixLines(text, indent)}\n`);
        break;
      }
      case 'code':
        out.push(`${prefixLines((t as Tokens.Code).text, indent)}\n\n`);
        break;
      case 'blockquote':
        out.push(`${prefixLines(blocks((t as Tokens.Blockquote).tokens, '').trim(), `${indent}> `)}\n\n`);
        break;
      case 'hr':
        out.push(`${indent}---\n\n`);
        break;
      case 'list':
        out.push(`${list(t as Tokens.List, indent)}\n`);
        break;
      case 'table':
        out.push(`${table(t as Tokens.Table, indent)}\n\n`);
        break;
      default:
        out.push(`${indent}${decode((t as WithRaw).raw ?? '')}\n`);
    }
  }
  return out.join('');
}

function list(l: Tokens.List, indent: string): string {
  const start = typeof l.start === 'number' ? l.start : 1;
  return l.items
    .map((item, i) => {
      const marker = l.ordered ? `${start + i}. ` : '- ';
      const check = item.task ? (item.checked ? '[x] ' : '[ ] ') : '';
      const pad = ' '.repeat(marker.length);
      const lines = blocks(item.tokens, '').trim().split('\n');
      const body = lines.map((line, j) => (j === 0 || !line ? line : pad + line)).join('\n');
      return `${indent}${marker}${check}${body}\n`;
    })
    .join('');
}

function table(t: Tokens.Table, indent: string): string {
  const row = (cells: Tokens.TableCell[]): string => indent + cells.map((c) => inline(c.tokens)).join(' | ');
  return [row(t.header), ...t.rows.map(row)].join('\n');
}
