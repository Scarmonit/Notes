/**
 * Mermaid diagrams, drawn after the markdown is on the page. The markdown
 * core leaves each ```mermaid fence as a `<pre class="mermaid" data-diagram>`
 * holding its source; this swaps each for the SVG mermaid draws from it.
 * Mermaid is loaded on first use — it is the largest thing in the bundle by
 * far, and a note without a diagram should never pay for it.
 */

export type DiagramTheme = 'dark' | 'neutral';

type Mermaid = typeof import('mermaid').default;

let loading: Promise<Mermaid> | null = null;
let currentTheme: DiagramTheme | null = null;
let counter = 0;

function load(): Promise<Mermaid> {
  if (!loading) {
    loading = import('mermaid').then((m) => m.default);
  }
  return loading;
}

async function ready(theme: DiagramTheme): Promise<Mermaid> {
  const mermaid = await load();
  if (currentTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict',
      fontFamily: theme === 'dark' ? 'Bahnschrift, "Segoe UI", system-ui, sans-serif' : '"Segoe UI", system-ui, sans-serif',
      ...(theme === 'dark' ? { themeVariables: { background: '#121722', primaryColor: '#232c3d', primaryTextColor: '#e8e4dc', lineColor: '#a3a9b6' } } : {}),
    });
    currentTheme = theme;
  }
  return mermaid;
}

/**
 * Draws every undrawn diagram under `root`. Resolves when all are done;
 * a diagram that will not parse shows its error in place of the picture,
 * with the source kept below, so a typo is a thing to fix, not a blank.
 */
export async function renderDiagrams(root: ParentNode, theme: DiagramTheme = 'dark'): Promise<number> {
  const pending = Array.from(root.querySelectorAll<HTMLElement>('pre.mermaid[data-diagram]'));
  if (pending.length === 0) return 0;
  const mermaid = await ready(theme);
  let drawn = 0;
  for (const pre of pending) {
    const source = pre.textContent ?? '';
    const holder = document.createElement('div');
    holder.className = 'diagram';
    try {
      const { svg, bindFunctions } = await mermaid.render(`diagram-${++counter}`, source);
      holder.innerHTML = svg;
      bindFunctions?.(holder);
      drawn++;
    } catch (err) {
      holder.className = 'diagram diagram-error';
      const message = document.createElement('div');
      message.className = 'diagram-message u';
      message.textContent = `Diagram: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`;
      const code = document.createElement('pre');
      code.textContent = source;
      holder.append(message, code);
      // Mermaid leaves the element it drew into behind on failure.
      document.getElementById(`ddiagram-${counter}`)?.remove();
    }
    pre.replaceWith(holder);
  }
  return drawn;
}
