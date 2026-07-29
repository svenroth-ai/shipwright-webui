/*
 * Bundle the INSTALLED mermaid for loading into a real browser.
 * iterate-2026-07-29-mermaid-real-render-e2e.
 *
 * The esbuild NODE API is required rather than the CLI: `stdin.resolveDir` is
 * the only way to make the bare specifier `mermaid` resolve from `client/`, and
 * the CLI has no `--resolve-dir` flag.
 *
 * ── The entry imports mermaid and NOTHING ELSE, on purpose ──────────────────
 * An earlier version also did `import DOMPurify from "dompurify"` so the page
 * could expose it. That silently destroyed the only property the sanitizer
 * guard is here to establish: with the harness importing DOMPurify itself,
 * {@link MermaidBundle.dompurifyPackages} was guaranteed non-empty whether or
 * not mermaid imported a sanitizer at all. Importing only mermaid makes the
 * count load-bearing in BOTH directions — 0 means mermaid dropped or vendored
 * its sanitizer, 2 means a duplicate copy, 1 means exactly the one mermaid
 * calls. (Stage-3 doubt review, 2026-07-29.)
 *
 * Consumers: `e2e/flows/mermaid-real-render.spec.ts`.
 */

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `client/` — the resolve root for the bare `mermaid` specifier. */
export const CLIENT_ROOT = path.resolve(HERE, "..", "..");

/** Shape of the global the bundle installs. */
export interface MermaidGlobal {
  __mermaid: {
    initialize(config: { startOnLoad: boolean; securityLevel: string }): void;
    render(id: string, text: string): Promise<{ svg: string }>;
  };
}

export interface MermaidBundle {
  /** IIFE source, ready for `page.addScriptTag({ content })`. ~7.9 MB. */
  code: string;
  /**
   * Distinct DOMPurify PACKAGE ROOTS mermaid pulled in — e.g.
   * `client/node_modules/dompurify/`. Deduped to the package root rather than
   * counted per module file: DOMPurify happens to ship its ESM build as one
   * file today, and nothing pins that, so counting files would turn a required
   * CI gate red on a healthy tree the day upstream splits its output — on
   * exactly the dependency-bump PR this suite exists to serve, with a message
   * misdiagnosing it as a duplicate instance. (Stage-3 doubt review.)
   */
  dompurifyPackages: string[];
  /**
   * esbuild's own warnings. Never discarded: esbuild WARNS rather than throws
   * when it cannot cleanly follow a dynamic import or a `require`, and a
   * harness whose whole premise is "notice when this dependency changes" must
   * not swallow the bundler's diagnostics about that dependency.
   */
  warnings: string[];
}

/** Built once per worker — the build is pure and the output is ~7.9 MB. */
let bundlePromise: Promise<MermaidBundle> | null = null;

/**
 * Bundle the installed mermaid. ~240 ms on first call, cached after that
 * (`workers: 1`, so one build per worker process; Playwright starts a fresh
 * worker after a failure, so a retry rebuilds rather than inheriting).
 */
export function mermaidBundle(): Promise<MermaidBundle> {
  bundlePromise ??= build({
    stdin: {
      contents: 'import mermaid from "mermaid";\nglobalThis.__mermaid = mermaid;',
      resolveDir: CLIENT_ROOT,
      loader: "js",
    },
    bundle: true,
    write: false,
    metafile: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    logLevel: "silent",
  }).then((result) => ({
    code: result.outputFiles[0].text,
    dompurifyPackages: dompurifyPackageRoots(Object.keys(result.metafile.inputs)),
    warnings: result.warnings.map((w) => w.text),
  }));
  return bundlePromise;
}

/** Distinct `…/node_modules/dompurify/` prefixes among esbuild's inputs. */
function dompurifyPackageRoots(inputs: string[]): string[] {
  const roots = new Set<string>();
  for (const raw of inputs) {
    const match = /^(.*(?:^|\/)node_modules\/dompurify\/)/.exec(
      raw.replace(/\\/g, "/"),
    );
    if (match) roots.add(match[1]);
  }
  return [...roots];
}
