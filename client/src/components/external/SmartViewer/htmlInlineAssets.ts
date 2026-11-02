/*
 * htmlInlineAssets — shows the IMAGES a sandboxed HTML page references.
 *
 * Same cause as the stylesheets (htmlInlineStyles): the srcdoc iframe has no
 * base URL, so a relative `<img src="shot.png">` can never load. The referenced
 * file is read through the Viewer's path-guarded file API (htmlResourceLoader)
 * and the attribute is rewritten to a `data:` URI.
 *
 * Handled: `<img src|srcset>`, `<source srcset>` (picture), `<video poster>`,
 * and inside CSS (a `<style>` block or an inlined stylesheet) `url(...)` of an
 * image / font plus `@import "x.css"` with nothing after the path. NOT handled
 * on purpose: scripts (a loaded script could read the project), `<video>` /
 * `<audio>` sources (too large), `style="..."` attributes, `@import` with a
 * media / supports / layer tail, `<a>` navigation.
 *
 * Only real tags are rewritten (comments and raw-text elements are masked first),
 * absolute / data / protocol-relative references are left alone, and anything
 * the loader refuses stays exactly as authored.
 */

import { withTimeout } from "./htmlInlineStyles";
import { ABSOLUTE_HREF, hasHiddenSegment, mapSrcset, mapTags, maskNonMarkup, refExtension, resolveAssetPath, rewriteAttrValues, type RawBlock } from "./htmlMarkupScan";
import { ASSET_TIMEOUT_MS, isAssetPath, type ResourceLoader } from "./htmlResourceLoader";

export const MAX_IMPORT_DEPTH = 3;

/** Per page (loader): the fully expanded text of each distinct imported stylesheet, so every @import occurrence can be replaced in place. */
const expansions = new WeakMap<ResourceLoader, Map<string, Promise<string | null>>>();

function expandImport(loader: ResourceLoader, path: string, depth: number, stack: ReadonlySet<string>): Promise<string | null> {
  const cache = expansions.get(loader) ?? new Map<string, Promise<string | null>>();
  expansions.set(loader, cache);
  if (stack.has(path)) return Promise.resolve(null); // a cycle: waiting on our own pending expansion would deadlock
  const hit = cache.get(path);
  if (hit) return hit;
  if (depth >= MAX_IMPORT_DEPTH || !loader.claimImport(path)) return Promise.resolve(null);
  const p = (async () => {
    const body = await withTimeout(loader.text(path), ASSET_TIMEOUT_MS);
    if (body === null) {
      loader.releaseImport(path); // unreadable: a later reference may try again
      cache.delete(path);
      return null;
    }
    return inlineCssResources(body, path, loader, depth + 1, new Set([...stack, path])).catch(() => body);
  })();
  cache.set(path, p);
  return p;
}

const MAX_IMPORTS_PER_FILE = 10;

// A bare character never spans a `<`, so an unterminated tag costs one line of input, not the rest of the document.
const MEDIA_TAG = /<(?:img|source|video)(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'"<>])*>/gi;
const TAG_NAME = /^<([a-z]+)/i;

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)/gi;
// `@import url(x.css);` | `@import "x.css";` — a trailing media / supports / layer list is deliberately not matched.
const CSS_IMPORT = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)|"([^"]*)"|'([^']*)')\s*;/gi;

/** `text` with every match of the global literal `re` replaced by `fn`'s result (null keeps the match). Fetches run in parallel. */
async function replaceAsync(text: string, re: RegExp, fn: (m: RegExpMatchArray) => Promise<string | null>, limit = Infinity): Promise<string> {
  const matches = [...text.matchAll(re)].slice(0, limit);
  const results = await Promise.all(matches.map(fn));
  let out = "";
  let cursor = 0;
  matches.forEach((m, i) => {
    const r = results[i];
    if (r === null) return;
    out += text.slice(cursor, m.index) + r;
    cursor = m.index + m[0].length;
  });
  return out + text.slice(cursor);
}

const firstDefined = (m: RegExpMatchArray, from: number, to: number): string => {
  for (let i = from; i <= to; i++) if (m[i] !== undefined) return m[i].trim();
  return "";
};

/**
 * `css` (the text of the file at `cssPath`, or of a `<style>` block of the page at `cssPath`) with its relative
 * `@import "x.css"` inlined (depth MAX_IMPORT_DEPTH, no cycles) and its relative image / font `url(...)` as `data:` URIs.
 */
export async function inlineCssResources(
  css: string,
  cssPath: string,
  loader: ResourceLoader,
  depth = 0,
  stack: ReadonlySet<string> = new Set([cssPath]),
): Promise<string> {
  const withImports = await replaceAsync(
    css,
    CSS_IMPORT,
    async (m) => {
      const ref = firstDefined(m, 1, 5);
      if (!ref || ABSOLUTE_HREF.test(ref) || refExtension(ref) !== "css" || hasHiddenSegment(ref)) return null;
      const path = resolveAssetPath(cssPath, ref);
      // Each distinct stylesheet is fetched once per page (MAX_IMPORTS); every occurrence is replaced IN PLACE so the
      // cascade order of `@import a; @import b; @import a;` is kept. A cycle (the file is on the current import stack)
      // and any insertion beyond the page's output budget stay as authored.
      const body = await expandImport(loader, path, depth, stack);
      return body !== null && loader.spend(body.length) ? body : null;
    },
    MAX_IMPORTS_PER_FILE,
  );
  return replaceAsync(withImports, CSS_URL, async (m) => {
    const ref = firstDefined(m, 1, 3);
    if (!ref || ABSOLUTE_HREF.test(ref)) return null;
    const path = ref.split(/[?#]/)[0];
    if (!isAssetPath(path)) return null;
    const data = await loader.dataUri(resolveAssetPath(cssPath, ref));
    const withFragment = data === null ? null : data + fragmentOf(ref); // `icons.svg#check` must keep selecting the symbol
    return withFragment === null || !loader.spend(withFragment.length) ? null : `url("${withFragment}")`;
  });
}

const fragmentOf = (ref: string): string => (ref.includes("#") ? ref.slice(ref.indexOf("#")) : "");

/** Rewrites the asset attributes of one tag; `map` returns the replacement for a reference or null to keep it. */
function rewriteTag(tag: string, map: (ref: string) => string | null): string {
  const one = (ref: string): string | null => {
    const r = ref.trim();
    return !r || ABSOLUTE_HREF.test(r) || !isAssetPath(r.split(/[?#]/)[0]) ? null : map(r);
  };
  const name = TAG_NAME.exec(tag)?.[1].toLowerCase();
  return rewriteAttrValues(tag, (attrName, value) => {
    if (attrName === "src" && name === "img") return one(value);
    if (attrName === "srcset" && (name === "img" || name === "source")) {
      const next = mapSrcset(value, one);
      return next === value ? null : next;
    }
    if (attrName === "poster" && name === "video") return one(value);
    return null;
  });
}

export async function inlineHtmlAssets(html: string, htmlPath: string, loader: ResourceLoader): Promise<string> {
  // 1. <style> blocks (offsets come from the ORIGINAL markup, so they are processed before any tag rewrite).
  const blocks: RawBlock[] = [];
  maskNonMarkup(html, blocks);
  const styled = await Promise.all(blocks.map((b) => inlineCssResources(html.slice(b.start, b.end), htmlPath, loader).catch(() => null)));
  let withStyles = "";
  let cursor = 0;
  blocks.forEach((b, i) => {
    const css = styled[i];
    if (css === null) return;
    withStyles += html.slice(cursor, b.start) + css.replace(/<\/style/gi, "<\\/style");
    cursor = b.end;
  });
  withStyles += html.slice(cursor);

  // 2. <img> / <source> / <video poster>: collect the distinct files, load them once, then rewrite.
  const wanted = new Map<string, string>(); // reference -> resolved path
  mapTags(withStyles, MEDIA_TAG, (tag) => {
    rewriteTag(tag, (ref) => {
      if (!wanted.has(ref)) wanted.set(ref, resolveAssetPath(htmlPath, ref));
      return null;
    });
    return tag;
  });
  const loaded = new Map<string, string | null>();
  await Promise.all([...wanted].map(async ([ref, path]) => loaded.set(ref, await loader.dataUri(path).catch(() => null))));
  // Every substitution is booked against the page's output budget: a file referenced thousands of times stops being inlined.
  return mapTags(withStyles, MEDIA_TAG, (tag) =>
    rewriteTag(tag, (ref) => {
      const data = loaded.get(ref) ?? null;
      const withFragment = data === null ? null : data + fragmentOf(ref);
      return withFragment !== null && loader.spend(withFragment.length) ? withFragment : null;
    }),
  );
}
