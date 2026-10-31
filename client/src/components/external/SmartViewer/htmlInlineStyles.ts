/*
 * htmlInlineStyles — makes a project's .html file render with its OWN
 * stylesheets inside the sandboxed srcdoc iframe.
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
 * MAX_LINKS are inlined.
 *
 * Known limits: relative `@import` / `url()` INSIDE the inlined CSS stay
 * relative and do not load (same opaque-origin reason); link detection is
 * best-effort for malformed markup.
 */

import { resolveDocPath } from "./useDocNavigation";

export const MAX_LINKS = 20;
export const FETCH_TIMEOUT_MS = 5000;

// Quote-aware, so a `>` inside an attribute value does not end the tag. The
// three branches start with disjoint characters, so matching stays linear.
const LINK_TAG = /<link(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
const ABSOLUTE_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const RAW_TEXT_OPEN = /^<(script|style|textarea|title)(?=[\s/>])/i;

const REL_ATTR = /(?:^|\s)rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HREF_ATTR = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const MEDIA_ATTR = /(?:^|\s)media\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const DISABLED_ATTR = /(?:^|\s)disabled(?=[\s=>/]|$)/i;

function attr(tag: string, re: RegExp): string | null {
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** Project-relative stylesheet href of a `<link>` tag we may inline, else null. */
function relativeStylesheetHref(tag: string): string | null {
  const rel = attr(tag, REL_ATTR);
  if (!rel || !/\bstylesheet\b/i.test(rel) || /\balternate\b/i.test(rel)) return null;
  if (DISABLED_ATTR.test(tag)) return null;
  const href = attr(tag, HREF_ATTR)?.trim();
  if (!href || ABSOLUTE_HREF.test(href)) return null;
  const path = href.split(/[?#]/)[0];
  if (!/\.css$/i.test(path)) return null;
  if (path.split(/[\\/]/).some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..")) return null;
  return path;
}

/**
 * `html` with comments and raw-text element contents blanked out (same
 * length). One pass: every closer is located with `indexOf` from the current
 * position, and an element that never closes masks the rest of the document
 * (as a browser would read it), so cost stays linear on any input.
 */
export function maskNonMarkup(html: string): string {
  const lower = html.toLowerCase();
  let out = "";
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    let end = -1;
    if (lower.startsWith("<!--", lt)) {
      const close = lower.indexOf("-->", lt + 4);
      end = close === -1 ? html.length : close + 3;
    } else {
      const open = RAW_TEXT_OPEN.exec(html.slice(lt, lt + 12));
      if (open) {
        const close = lower.indexOf(`</${open[1].toLowerCase()}`, lt + open[0].length);
        if (close === -1) end = html.length;
        else {
          const gt = lower.indexOf(">", close);
          end = gt === -1 ? html.length : gt + 1;
        }
      }
    }
    if (end === -1) {
      out += html.slice(i, lt + 1);
      i = lt + 1;
    } else {
      out += html.slice(i, lt) + " ".repeat(end - lt);
      i = end;
    }
  }
  return out + html.slice(i);
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
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
): Promise<string> {
  const links = findLinks(html);
  const css = await Promise.all(
    links.map((l) => withTimeout(fetchText(resolveDocPath(htmlPath, l.href).path), timeoutMs)),
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
