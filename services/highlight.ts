import { visit, SKIP } from 'unist-util-visit';

// Locates verification-flag excerpts in the rendered notes and wraps them
// in <mark>. Excerpts are model-quoted markdown, but by rendering time the
// markdown syntax is gone and the text is split across inline elements
// (**bold** key terms are the norm in generated notes) — so matching runs
// per block element over its concatenated text, wrapping every text node
// the match touches. Excerpts that still can't be found (e.g. spanning two
// paragraphs, or edited away) simply don't highlight; the flags list shows
// them tagged "not located".

// Reduce a markdown fragment to roughly what its rendered text looks like.
const stripMarkdownSyntax = (s: string): string =>
  s
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Whitespace-flexible pattern for an excerpt; null if too short to match safely.
const toPattern = (excerpt: string): RegExp | null => {
  const text = stripMarkdownSyntax(excerpt);
  if (text.length < 4) return null;
  const escaped = text
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(escaped);
};

// Used by the flags list to decide whether to show "not located in current text".
export const isExcerptLocated = (markdown: string, excerpt: string): boolean => {
  if (markdown.includes(excerpt)) return true;
  const pattern = toPattern(excerpt);
  return pattern ? pattern.test(stripMarkdownSyntax(markdown)) : false;
};

interface HastText { type: 'text'; value: string; }
interface HastElement { type: 'element'; tagName: string; properties?: Record<string, unknown>; children: Array<HastText | HastElement>; }

const BLOCK_TAGS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'blockquote']);

const makeMark = (value: string): HastElement => ({
  type: 'element',
  tagName: 'mark',
  properties: { className: ['bg-amber-200/70', 'rounded', 'px-0.5'] },
  children: [{ type: 'text', value }],
});

// Text nodes of a block in render order, skipping already-marked spans.
const collectTextNodes = (element: HastElement): Array<{ node: HastText; parent: HastElement }> => {
  const entries: Array<{ node: HastText; parent: HastElement }> = [];
  const walk = (parent: HastElement) => {
    for (const child of parent.children) {
      if (child.type === 'text') entries.push({ node: child, parent });
      else if (child.type === 'element' && child.tagName !== 'mark') walk(child);
    }
  };
  walk(element);
  return entries;
};

// Wrap the [start, end) range of the block's concatenated text in <mark>,
// splitting each text node the range overlaps.
const wrapRange = (entries: Array<{ node: HastText; parent: HastElement }>, start: number, end: number) => {
  let offset = 0;
  for (const { node, parent } of entries) {
    const nodeStart = offset;
    const nodeEnd = offset + node.value.length;
    offset = nodeEnd;

    const overlapStart = Math.max(start, nodeStart) - nodeStart;
    const overlapEnd = Math.min(end, nodeEnd) - nodeStart;
    if (overlapStart >= overlapEnd) continue;

    const index = parent.children.indexOf(node);
    if (index === -1) continue;
    const parts: Array<HastText | HastElement> = [];
    if (overlapStart > 0) parts.push({ type: 'text', value: node.value.slice(0, overlapStart) });
    parts.push(makeMark(node.value.slice(overlapStart, overlapEnd)));
    if (overlapEnd < node.value.length) parts.push({ type: 'text', value: node.value.slice(overlapEnd) });
    parent.children.splice(index, 1, ...parts);
  }
};

export function rehypeHighlightFlags(options: { excerpts: string[] }) {
  const patterns = (options?.excerpts ?? [])
    .map(toPattern)
    .filter((p): p is RegExp => p !== null);

  return (tree: unknown) => {
    if (patterns.length === 0) return;
    visit(tree as never, 'element', (node: HastElement) => {
      if (!BLOCK_TAGS.has(node.tagName)) return undefined;

      for (const pattern of patterns) {
        // Re-collect after each wrap: earlier splices invalidate offsets
        const entries = collectTextNodes(node);
        const match = pattern.exec(entries.map(e => e.node.value).join(''));
        if (!match) continue;
        wrapRange(entries, match.index, match.index + match[0].length);
      }
      // Blocks nest (li > p): the outer pass already handled this subtree
      return SKIP;
    });
  };
}
