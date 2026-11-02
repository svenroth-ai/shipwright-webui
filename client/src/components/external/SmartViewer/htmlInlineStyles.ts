/*
 * htmlInlineStyles — makes a .html file render with its OWN stylesheets inside
 * the sandboxed srcdoc iframe.
 *
 * The iframe has an opaque origin and no base URL, so a relative
 * `<link rel="stylesheet" href="mockup.css">` can never load (and the CSP
 * forbids it anyway). Instead the SmartViewer reads each RELATIVE stylesheet
 * through the same path-guarded file API it uses for the HTML itself and
 * inlines it as `<style>`.
 *
 * Security: the HTML is untrusted and runs scripts, so whatever is inlined is
 * readable by it. Only `.css` files are ever fetched, and never from a dot
 * segment (`.env`, `.git/`), so an opened page cannot use `rel=stylesheet` as
 * a read primitive for other project files.
 *
 * Only real link elements are rewritten: comments and raw-text elements
 * (script / style / textarea / title) are masked by a linear scanner first, so
 * a link-shaped string inside a script is never touched. `media` is carried
 * over; `alternate` / `disabled` stylesheets are left as they are. Absolute,
 * protocol-relative and data links are left to the CSP, a stylesheet that
 * fails or stalls (FETCH_TIMEOUT_MS) stays a plain `<link>`, and at most
 * MAX_LINKS are inlined. `processCss` (htmlInlineAssets) runs over each
 * fetched stylesheet so its own `@import` / `url()` references are inlined too.
 */

import { ABSOLUTE_HREF, attr, hasHiddenSegment, maskNonMarkup, refExtension, resolveAssetPath } from "./htmlMarkupScan";

export { maskNonMarkup };
export const MAX_LINKS = 20;
export const FETCH_TIMEOUT_MS = 5000;

// Quote-aware, so a `>` inside an attribute value does not end the tag. The
// three branches start with disjoint characters and a bare character never
// spans a `<`, so an unterminated tag costs one line of input, not the rest of the document.
const LINK_TAG = /<link(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'"<>])*>/gi;

const REL_ATTR = /(?:^|\s)rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HREF_ATTR = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const MEDIA_ATTR = /(?:^|\s)media\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const DISABLED_ATTR = /(?:^|\s)disabled(?=[\s=>/]|$)/i;

/** Project-relative stylesheet href of a `<link>` tag we may inline, else null. */
function relativeStylesheetHref(tag: string): string | null {
  const rel = attr(tag, REL_ATTR);
  if (!rel || !/\bstylesheet\b/i.test(rel) || /\balternate\b/i.test(rel)) return null;
  if (DISABLED_ATTR.test(tag)) return null;
  const href = attr(tag, HREF_ATTR)?.trim();
  if (!href || ABSOLUTE_HREF.test(href)) return null;
  const path = href.split(/[?#]/)[0];
  if (refExtension(path) !== "css" || hasHiddenSegment(path)) return null;
  return path;
}

interface Found {
  start: number;
  end: number;
  tag: string;
  href: string;
}

function findLinks(html: string): Found[] {
  const found: Found[] = [];
  for (const m of maskNonMarkup(html).matchAll(LINK_TAG)) {
    const tag = html.slice(m.index, m.index + m[0].length);
    const href = relativeStylesheetHref(tag);
    if (href) found.push({ start: m.index, end: m.index + m[0].length, tag, href });
    if (found.length >= MAX_LINKS) break;
  }
  return found;
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export async function inlineLinkedStyles(
  html: string,
  htmlPath: string,
  fetchText: (path: string) => Promise<string>,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  processCss?: (css: string, cssPath: string) => Promise<string>,
): Promise<string> {
  const links = findLinks(html);
  const css = await Promise.all(
    links.map((l) => {
      const cssPath = resolveAssetPath(htmlPath, l.href);
      // Only the stylesheet fetch is under this timeout; what it references is bounded by the loader's own.
      return withTimeout(fetchText(cssPath), timeoutMs).then((body) =>
        body !== null && processCss ? processCss(body, cssPath).catch(() => body) : body,
      );
    }),
  );
  let out = "";
  let cursor = 0;
  links.forEach((l, i) => {
    const body = css[i];
    if (body === null) return; // leave the original <link>; the page renders unstyled
    const media = attr(l.tag, MEDIA_ATTR);
    const open = media ? `<style media="${media.replace(/"/g, "&quot;")}">` : "<style>";
    out += html.slice(cursor, l.start) + open + body.replace(/<\/style/gi, "<\\/style") + "</style>";
    cursor = l.end;
  });
  return out + html.slice(cursor);
}
