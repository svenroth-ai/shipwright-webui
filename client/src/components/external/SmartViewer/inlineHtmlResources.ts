/*
 * inlineHtmlResources — the one entry point the HtmlRenderer calls: turns an
 * HTML page's RELATIVE references (stylesheets, images, CSS `url()` / `@import`)
 * into inline content so the sandboxed srcdoc iframe renders it complete.
 * Why and what is deliberately left out: htmlInlineStyles + htmlInlineAssets.
 *
 * Order matters: the page's own `<style>` blocks and media tags are processed
 * first, while their offsets and base path are the page's. Linked stylesheets
 * are turned into `<style>` last, each one already resolved against ITS OWN path.
 */

import { inlineHtmlAssets, inlineCssResources } from "./htmlInlineAssets";
import { FETCH_TIMEOUT_MS, inlineLinkedStyles } from "./htmlInlineStyles";
import type { ResourceLoader } from "./htmlResourceLoader";

export async function inlineHtmlResources(html: string, htmlPath: string, loader: ResourceLoader): Promise<string> {
  const withAssets = await inlineHtmlAssets(html, htmlPath, loader).catch(() => html);
  return inlineLinkedStyles(withAssets, htmlPath, loader.text, FETCH_TIMEOUT_MS, (css, cssPath) =>
    inlineCssResources(css, cssPath, loader),
  );
}
