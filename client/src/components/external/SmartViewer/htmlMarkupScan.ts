/*
 * htmlMarkupScan — the shared, dependency-free scanning helpers behind the
 * SmartViewer's HTML resource inlining (htmlInlineStyles / htmlInlineAssets).
 *
 * All regexes are literals (the Semgrep detect-non-literal-regexp ratchet,
 * CLAUDE.md DO-NOT #31, forbids building them from data).
 */

import { resolveDocPath } from "./useDocNavigation";

/** A scheme (`https:`, `data:`), a protocol-relative `//host` or a bare `#fragment`: never project-relative. */
export const ABSOLUTE_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const RAW_TEXT_OPEN = /^<(script|style|textarea|title)(?=[\s/>])/i;
// The end of an open tag, quote-aware (a `>` inside an attribute value does not end it).
const OPEN_TAG_END = /(?:"[^"]*"|'[^']*'|[^'">])*>/y;
const ABSOLUTE_FILE_PATH = /^(?:[a-zA-Z]:[\\/]|\/)/;

export interface RawBlock {
  /** Index of the first character of the element content. */
  start: number;
  /** Index of the `</tag` that ends it. */
  end: number;
}

/**
 * `html` with comments and raw-text element contents blanked out (same
 * length). One pass: every closer is located with `indexOf` from the current
 * position, and an element that never closes masks the rest of the document
 * (as a browser would read it), so cost stays linear on any input. When
 * `styleBlocks` is given, the content range of every CLOSED `<style>` element
 * outside a comment is recorded in it (so its CSS can be processed).
 */
export function maskNonMarkup(html: string, styleBlocks?: RawBlock[]): string {
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
        const name = open[1].toLowerCase();
        const close = lower.indexOf(`</${name}`, lt + open[0].length);
        if (close === -1) end = html.length;
        else {
          const gt = lower.indexOf(">", close);
          end = gt === -1 ? html.length : gt + 1;
          if (name === "style" && styleBlocks) {
            OPEN_TAG_END.lastIndex = lt + open[0].length;
            const openEnd = OPEN_TAG_END.exec(html);
            const start = openEnd ? lt + open[0].length + openEnd[0].length : -1;
            if (start !== -1 && start <= close) styleBlocks.push({ start, end: close });
          }
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

/** The value of the first attribute matched by `re` (groups 1-3 = dq / sq / bare value), else null. */
export function attr(tag: string, re: RegExp): string | null {
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/**
 * Rewrites every tag matched by `re` (a global literal regex) in the markup
 * of `html` (never inside comments / script / style / textarea / title):
 * `fn` gets the ORIGINAL tag text and returns its replacement.
 */
export function mapTags(html: string, re: RegExp, fn: (tag: string) => string): string {
  let out = "";
  let cursor = 0;
  for (const m of maskNonMarkup(html).matchAll(re)) {
    const tag = html.slice(m.index, m.index + m[0].length);
    out += html.slice(cursor, m.index) + fn(tag);
    cursor = m.index + m[0].length;
  }
  return out + html.slice(cursor);
}

function decoded(ref: string): string {
  try {
    return decodeURIComponent(ref);
  } catch {
    return ref;
  }
}

/** True when any path segment (after decoding) starts with "." — `.env`, `.git`, `.ssh`, hidden folders. `.` / `..` are navigation, not hidden. */
export function hasHiddenSegment(ref: string): boolean {
  return decoded(ref)
    .split(/[\\/]/)
    .some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..");
}

/** The file extension of a reference without query / fragment, lower-case, no dot ("" if none). */
export function refExtension(ref: string): string {
  const path = ref.split(/[?#]/)[0];
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Resolves `href` against the page that contains it. A project page
 * (project-root-relative path) clamps at the project root like every other
 * Viewer link; an OUTSIDE page (absolute path) resolves to an absolute path
 * with forward slashes — the server decides whether that file may be read.
 */
export function resolveAssetPath(pagePath: string, href: string): string {
  const raw = href.split(/[?#]/)[0];
  if (!ABSOLUTE_FILE_PATH.test(pagePath)) return resolveDocPath(pagePath, raw).path;
  const base = pagePath.replace(/\\/g, "/");
  const root = /^(?:[a-zA-Z]:)?\//.exec(base)![0];
  const dir = base.slice(root.length).split("/");
  dir.pop(); // the page's own file name
  for (const seg of decoded(raw).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") dir.pop();
    else dir.push(seg);
  }
  return root + dir.join("/");
}

/**
 * Rewrites attribute VALUES of one tag. Attributes are tokenized with their quoting respected (so `alt=" src=x"` is
 * the value of `alt`, never an attribute `src`); `fn(name, value)` returns the new value or null to keep it. An
 * unquoted value that changes is emitted quoted; a quoted one keeps its quote character.
 */
export function rewriteAttrValues(tag: string, fn: (name: string, value: string) => string | null): string {
  const n = tag.length;
  const edits: { start: number; end: number; text: string }[] = [];
  let i = tag.search(/[\s/>]/);
  if (i < 0) return tag;
  while (i < n) {
    while (i < n && /[\s/]/.test(tag[i])) i++;
    if (i >= n || tag[i] === ">") break;
    const nameStart = i;
    while (i < n && !/[\s=/>]/.test(tag[i])) i++;
    if (i === nameStart) i++; // a stray "=": step over it
    const name = tag.slice(nameStart, i).toLowerCase();
    let j = i;
    while (j < n && /\s/.test(tag[j])) j++;
    if (tag[j] !== "=") continue; // valueless attribute
    j++;
    while (j < n && /\s/.test(tag[j])) j++;
    const quote = tag[j] === '"' || tag[j] === "'" ? tag[j] : "";
    let start = j;
    let end: number;
    if (quote) {
      start = j + 1;
      const close = tag.indexOf(quote, start);
      end = close === -1 ? n : close;
      i = close === -1 ? n : close + 1;
    } else {
      while (j < n && !/[\s>]/.test(tag[j])) j++;
      end = j;
      i = j;
    }
    const next = fn(name, tag.slice(start, end));
    if (next !== null) edits.push(quote ? { start, end, text: next } : { start, end, text: `"${next}"` });
  }
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    out += tag.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  return out + tag.slice(cursor);
}

/**
 * Maps the URL of every candidate of a `srcset` value (HTML grammar: a URL is a run of non-whitespace characters,
 * trailing commas end the candidate, descriptors run to the next comma). Candidates `fn` leaves alone stay byte-exact.
 */
export function mapSrcset(value: string, fn: (url: string) => string | null): string {
  let out = "";
  let i = 0;
  const n = value.length;
  while (i < n) {
    const sep = i;
    while (i < n && /[\s,]/.test(value[i])) i++;
    out += value.slice(sep, i);
    if (i >= n) break;
    const urlStart = i;
    while (i < n && !/\s/.test(value[i])) i++;
    let url = value.slice(urlStart, i);
    let trailing = "";
    while (url.endsWith(",")) {
      trailing += ",";
      url = url.slice(0, -1);
    }
    out += (fn(url) ?? url) + trailing;
    if (trailing) continue; // the comma ended the candidate: no descriptors
    const descStart = i;
    while (i < n && value[i] !== ",") i++;
    out += value.slice(descStart, i);
  }
  return out;
}
