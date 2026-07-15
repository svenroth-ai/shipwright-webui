/*
 * DocumentMarkdown — SmartViewer's markdown renderer for PROJECT FILES
 * (iterate-2026-05-30-smartviewer-render-ux, FR-01.02).
 *
 * The transcript's `MarkdownText` MUST keep the no-raw-HTML XSS contract
 * (DO-NOT guards #4/#5 — it renders Claude output). File preview content is
 * the user's OWN project docs, so this separate renderer enables a CONTROLLED
 * subset of HTML:
 *   - `rehype-raw` parses inline/block HTML so `<a id="trg-…">` anchors + the
 *     RTM cross-links resolve (AC7) and `<!-- … -->` comments become comment
 *     nodes that the sanitizer drops (AC4) …
 *   - … ALWAYS paired with `rehype-sanitize` (custom schema below) — no
 *     `<script>` / `on*` / `style` / `javascript:` survives, and the default
 *     `user-content-` clobber prefix is RETAINED (DOM-clobbering defense).
 *   - `rehype-slug` stamps heading IDs so `[…](#heading)` links resolve (AC8).
 *   - leading YAML frontmatter (`---…---`) is preprocessed into a fenced
 *     ```yaml block so it renders as a recognisable metadata block (AC6).
 *
 * Anchor nav (AC8) — two cases, both scoped to THIS pane (never the window):
 *   - same-document `#fragment` → scroll the matching id into view here.
 *   - relative `*.md(#frag)` cross-file link (e.g. the RTM → spec.md) →
 *     delegated to `onDocLinkClick`, which the SmartViewer follows in-pane
 *     and re-lands via `scrollToFragment`.
 * Fragment resolution checks both the raw id AND its `user-content-`-prefixed
 * form (raw-HTML anchor ids are prefixed by the sanitizer; rehype-slug heading
 * ids are added after sanitize and stay unprefixed).
 */

import { useCallback, useEffect, useMemo, useRef, type ReactNode, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";

import { MermaidRenderer } from "./MermaidRenderer";

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "id", "className"],
  },
};

const CLOBBER_PREFIX = "user-content-";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
  rehypeSlug,
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
] as const;

interface Props {
  text: string;
  /** Follow a relative `*.md(#frag)` cross-file link in-pane (AC8). */
  onDocLinkClick?: (href: string) => void;
  /** Scroll to this fragment once, after a cross-file navigation lands. */
  scrollToFragment?: string | null;
}

/**
 * Convert a leading YAML frontmatter block (`---\n…\n---`) into a fenced
 * ```yaml code block so it renders as a recognisable metadata block instead
 * of a `<hr>` + raw body text. Only fires on a fully-closed leading fence at
 * position 0; otherwise returns the text unchanged. Exported for unit tests.
 */
export function frontmatterToCodeFence(text: string): string {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  // Reject a leading thematic break masquerading as frontmatter: real
  // frontmatter has a non-empty body whose first line is `key: value`, not a
  // blank line (which is what `---`-HR-then-prose-then-`---` would capture).
  if (!m || !m[1].trim() || /^[ \t]*\r?\n/.test(m[1])) return text;
  return "```yaml\n" + m[1] + "\n```\n" + text.slice(m[0].length);
}

/** A relative link to another previewable doc (`*.md`), not `#frag`/http(s). */
export function isInternalDocLink(href: string): boolean {
  if (!href || href.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return false;
  return /\.(md|markdown)(#.*)?$/i.test(href);
}

/**
 * Resolve a `#fragment` link to its target element within `container`,
 * accounting for the sanitizer's `user-content-` clobber prefix on raw-HTML
 * ids (rehype-slug heading ids stay unprefixed). Exact id comparison — robust
 * to any id characters. Exported for unit tests.
 */
export function findAnchorTarget(
  container: HTMLElement,
  fragId: string,
): HTMLElement | null {
  const wanted = new Set([fragId, CLOBBER_PREFIX + fragId]);
  for (const el of container.querySelectorAll<HTMLElement>("[id]")) {
    if (wanted.has(el.id)) return el;
  }
  return null;
}

/** Nearest scrollable ancestor — the SmartViewer pane, NOT the window. */
function nearestScrollParent(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement ?? null;
  while (n) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") return n;
    n = n.parentElement;
  }
  return null;
}

function scrollTargetIntoPane(container: HTMLElement, target: HTMLElement): void {
  const scroller = nearestScrollParent(container);
  if (scroller) {
    const tr = target.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    scroller.scrollTop += tr.top - sr.top - 12; // 12px ≈ scroll-margin-top
    scroller.scrollLeft += tr.left - sr.left;
  } else {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function childrenToString(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToString).join("");
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "object" && "props" in children) {
    return childrenToString(
      (children as { props: { children?: ReactNode } }).props.children,
    );
  }
  return String(children);
}

const COMPONENTS = {
  // Preserve mermaid-in-markdown diagrams for file preview (the old
  // MarkdownText path supported them); everything else falls through to the
  // default <code>/<pre> + rehype-highlight.
  code(props: { className?: string; children?: ReactNode; node?: unknown }) {
    const { className, children, node: _node, ...rest } = props;
    if (typeof className === "string" && /\blanguage-mermaid\b/.test(className)) {
      return <MermaidRenderer text={childrenToString(children)} />;
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
  a(props: { href?: string; children?: ReactNode; id?: string }) {
    const { href, ...rest } = props;
    // Bare anchor target (`<a id="trg-…"></a>`) — invisible jump target.
    if (!href) return <a {...rest} />;
    // Same-document fragment OR relative cross-file doc link — keep a real
    // href (keyboard-focusable); the container's delegated onClick navigates.
    if (href.startsWith("#") || isInternalDocLink(href)) {
      return <a href={href} {...rest} />;
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-info underline decoration-[var(--info-line)] hover:decoration-[var(--info)]"
        {...rest}
      />
    );
  },
};

export function DocumentMarkdown({ text, onDocLinkClick, scrollToFragment }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const processed = useMemo(() => frontmatterToCodeFence(text), [text]);

  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      const container = ref.current;
      if (!container) return;
      if (href.startsWith("#")) {
        if (href === "#") return;
        const target = findAnchorTarget(container, decodeURIComponent(href.slice(1)));
        if (!target) return; // unknown fragment — let the browser handle it
        e.preventDefault();
        scrollTargetIntoPane(container, target);
        return;
      }
      if (onDocLinkClick && isInternalDocLink(href)) {
        e.preventDefault();
        onDocLinkClick(href);
      }
    },
    [onDocLinkClick],
  );

  // After a cross-file navigation lands (new text + fragment), scroll to it.
  useEffect(() => {
    if (!scrollToFragment) return;
    const container = ref.current;
    if (!container) return;
    const target = findAnchorTarget(container, scrollToFragment);
    if (target) scrollTargetIntoPane(container, target);
  }, [scrollToFragment, processed]);

  return (
    <div
      ref={ref}
      className="markdown-body text-sm leading-relaxed"
      data-testid="document-markdown"
      onClick={onClick}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS as never}
        components={COMPONENTS}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
