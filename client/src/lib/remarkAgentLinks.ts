/*
 * remarkAgentLinks - turns agent hashes in prose into links (`agent:<fullId>`) that MarkdownText
 * renders as clickable chips (V3). Only plain text nodes are rewritten: code, inline code and
 * existing links are left alone. A token counts only when it IS a known agent id or an unambiguous
 * prefix (>= 8 hex chars) of one, so ordinary hex-looking words stay text.
 */

interface MdNode { type: string; value?: string; url?: string; children?: MdNode[] }

const TOKEN = /\b[0-9a-f]{8,32}\b/gi;
const SKIP = new Set(["code", "inlineCode", "link", "linkReference", "definition", "html"]);
export const AGENT_HREF_PREFIX = "agent:";

/** Full agent id for a hash token (exact or unique prefix), else null. */
export function resolveAgentToken(token: string, ids: readonly string[]): string | null {
  const t = token.toLowerCase();
  if (t.length < 8) return null;
  const exact = ids.find((id) => id.toLowerCase() === t);
  if (exact) return exact;
  const hits = ids.filter((id) => id.toLowerCase().startsWith(t));
  return hits.length === 1 ? hits[0] : null;
}

function split(value: string, ids: readonly string[]): MdNode[] | null {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN)) {
    const id = resolveAgentToken(m[0], ids);
    if (!id) continue;
    if (m.index! > last) out.push({ type: "text", value: value.slice(last, m.index) });
    out.push({ type: "link", url: AGENT_HREF_PREFIX + id, children: [{ type: "text", value: m[0].slice(0, 8) }] });
    last = m.index! + m[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node: MdNode, ids: readonly string[]): void {
  if (!node.children || SKIP.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    const parts = child.type === "text" && child.value ? split(child.value, ids) : null;
    if (parts) next.push(...parts);
    else {
      walk(child, ids);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkAgentLinks(options: { ids: readonly string[] }) {
  return (tree: MdNode) => walk(tree, options.ids);
}
