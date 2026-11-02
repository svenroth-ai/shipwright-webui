/*
 * htmlResourceLoader — reads the files an HTML page references (stylesheets as
 * text, images and fonts as `data:` URIs) through the Viewer's path-guarded
 * file API, so the sandboxed srcdoc iframe can show them.
 *
 * Bounds (one loader per rendered page — stylesheets included: they share the
 * request queue, the abort and the output budget): MAX_ASSETS distinct image/font files,
 * MAX_ASSET_BYTES of them in total (checked against Content-Length before the
 * body is read), MAX_IN_FLIGHT requests at once, ASSET_TIMEOUT_MS per request,
 * MAX_IMPORTS distinct `@import`ed stylesheets per page (each at most the 1 MB
 * text cap) — an `@import` tree cannot multiply — and MAX_INLINE_CHARS of data
 * URIs written into the document in total, so one file referenced thousands of
 * times cannot inflate the page. `dispose()` aborts what is in flight and
 * releases what is queued (the page was replaced). Anything over a bound,
 * refused (403/415), missing or slow resolves to null and the page simply keeps
 * its original reference. Only image / font extensions are ever requested, and
 * never from a dot segment — a scripted page must not be able to use this as a
 * read primitive for other files (see htmlInlineStyles).
 */

import { CLIENT_FILE_TEXT_MAX_BYTES } from "../../../lib/externalApi";
import { hasHiddenSegment, refExtension } from "./htmlMarkupScan";

export const MAX_ASSETS = 40;
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const MAX_IN_FLIGHT = 6;
export const MAX_IMPORTS = 20;
export const MAX_INLINE_CHARS = 30 * 1024 * 1024;
export const ASSET_TIMEOUT_MS = 5000;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
};

/** True for a path the loader will fetch as an asset (image / font extension, no dot segment). */
export function isAssetPath(path: string): boolean {
  return Object.hasOwn(MIME_BY_EXTENSION, refExtension(path)) && !hasHiddenSegment(path);
}

export interface ResourceLoader {
  /** Stylesheet text; rejects when the file cannot be read. */
  text(path: string): Promise<string>;
  /** `data:` URI of an image / font, or null (not allowed, over a bound, failed). */
  dataUri(path: string): Promise<string | null>;
  /** First caller wins: true when `path` may be `@import`ed now (not yet inlined on this page, under MAX_IMPORTS). */
  claimImport(path: string): boolean;
  /** Give a claim back (the stylesheet could not be read), so a later reference may try again. */
  releaseImport(path: string): void;
  /** True when `chars` more characters of inlined data still fit the page's output budget (and books them). */
  spend(chars: number): boolean;
  /** The page was replaced: abort in-flight requests, resolve queued ones to null, refuse new ones. */
  dispose(): void;
}

function readAsDataUri(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export interface LoaderLimits {
  timeoutMs?: number;
  maxAssets?: number;
  maxBytes?: number;
  maxInFlight?: number;
  maxImports?: number;
  maxInlineChars?: number;
}

export function createResourceLoader(urlFor: (path: string) => string, limits: LoaderLimits = {}): ResourceLoader {
  const { timeoutMs = ASSET_TIMEOUT_MS, maxAssets = MAX_ASSETS, maxBytes = MAX_ASSET_BYTES, maxInFlight = MAX_IN_FLIGHT, maxImports = MAX_IMPORTS, maxInlineChars = MAX_INLINE_CHARS } = limits;
  const cache = new Map<string, Promise<string | null>>();
  const imports = new Set<string>();
  const controllers = new Set<AbortController>();
  let bytes = 0;
  let chars = 0;
  let disposed = false;
  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = (): Promise<void> => {
    if (active < maxInFlight) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve)); // the slot is handed over, `active` stays counted
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  /** Runs `job` in one of the request slots with an abort signal and a timeout; null when disposed, otherwise its result. */
  async function guarded<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    await acquire();
    if (disposed) {
      release();
      return null;
    }
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await job(controller.signal);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
      release();
    }
  }

  async function fetchAsset(path: string): Promise<string | null> {
    try {
      return (await guarded((signal) => assetDataUri(path, signal))) ?? null;
    } catch {
      return null;
    }
  }

  async function assetDataUri(path: string, signal: AbortSignal): Promise<string | null> {
    {
      const r = await fetch(urlFor(path), { signal });
      if (!r.ok) return null;
      const declared = Number(r.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes - bytes) return null;
      const blob = await r.blob();
      if (bytes + blob.size > maxBytes) return null;
      bytes += blob.size;
      const typed = blob.type ? blob : new Blob([blob], { type: MIME_BY_EXTENSION[refExtension(path)] });
      return await readAsDataUri(typed);
    }
  }

  return {
    async text(path) {
      const body = await guarded(async (signal) => {
        const r = await fetch(urlFor(path), { signal });
        if (!r.ok) throw new Error(`stylesheet ${r.status}`);
        const text = await r.text();
        if (text.length > CLIENT_FILE_TEXT_MAX_BYTES) throw new Error("stylesheet too large");
        return text;
      });
      if (body === null) throw new Error("loader disposed");
      return body;
    },
    dataUri(path) {
      if (disposed || !isAssetPath(path)) return Promise.resolve(null);
      const hit = cache.get(path);
      if (hit) return hit;
      if (cache.size >= maxAssets) return Promise.resolve(null);
      const p = fetchAsset(path);
      cache.set(path, p);
      return p;
    },
    claimImport(path) {
      if (disposed || imports.has(path) || imports.size >= maxImports) return false;
      imports.add(path);
      return true;
    },
    releaseImport: (path) => void imports.delete(path),
    spend(n) {
      if (chars + n > maxInlineChars) return false;
      chars += n;
      return true;
    },
    dispose() {
      disposed = true;
      for (const c of controllers) c.abort();
      while (waiting.length > 0) waiting.shift()!(); // queued requests wake up, see `disposed` and resolve null
    },
  };
}
