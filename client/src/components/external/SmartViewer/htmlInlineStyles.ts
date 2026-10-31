/*
 * htmlInlineStyles — makes a project's .html file render with its OWN
 * stylesheets inside the sandboxed srcdoc iframe.
 *
 * The iframe has an opaque origin and no base URL, so a relative
 * `<link rel="stylesheet" href="mockup.css">` can never load (and the CSP
 * forbids it anyway). Instead the SmartViewer reads each RELATIVE stylesheet
 * through the same path-guarded file API it uses for the HTML itself and
 * inlines it as `<style>`. Absolute / protocol-relative / data links are left
 * untouched (the CSP decides); a stylesheet that fails to load is left as-is.
 */

import { resolveDocPath } from "./useDocNavigation";

const LINK_TAG = /<link\b[^>]*>/gi;
const ABSOLUTE_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** Relative stylesheet href of a `<link>` tag, or null when it is not one. */
function relativeStylesheetHref(tag: string): string | null {
  const rel = attr(tag, "rel");
  if (!rel || !/\bstylesheet\b/i.test(rel)) return null;
  const href = attr(tag, "href")?.trim();
  if (!href || ABSOLUTE_HREF.test(href)) return null;
  return href.split(/[?#]/)[0] || null;
}

export async function inlineLinkedStyles(
  html: string,
  htmlPath: string,
  fetchText: (path: string) => Promise<string>,
): Promise<string> {
  const tags = Array.from(new Set(html.match(LINK_TAG) ?? []));
  const replacements = new Map<string, string>();
  await Promise.all(
    tags.map(async (tag) => {
      const href = relativeStylesheetHref(tag);
      if (!href) return;
      try {
        const css = await fetchText(resolveDocPath(htmlPath, href).path);
        replacements.set(tag, `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`);
      } catch {
        /* leave the original <link>; the page just renders unstyled */
      }
    }),
  );
  let out = html;
  for (const [tag, style] of replacements) out = out.split(tag).join(style);
  return out;
}
