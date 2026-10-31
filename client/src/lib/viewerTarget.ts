/*
 * viewerTarget — the ONE way a file path (an Outputs row, a chat chip, a tree
 * pick) becomes something the Smart Viewer can open (V6, FR-01.66 family).
 *
 *   inside the project root  -> { path: <root-relative POSIX>, outside: false }
 *                               served by the project file route (full viewer
 *                               features: edit, linked stylesheets, doc links)
 *   anywhere else (absolute) -> { path: <absolute>, outside: true }
 *                               served by the task-scoped session-file route
 *                               (server decides: only paths THIS session evidences)
 *
 * Pure text recognition; no I/O. The server stays the authority on access.
 */

import { RECOGNIZED_EXTENSIONS } from "./extractFileMentions";
import { relativeToCwd } from "./sessionInfoFormat";

export interface ViewerTarget {
  path: string;
  outside: boolean;
  /** 1-based line from a `file.ts:98` / `#L98` suffix (informational). */
  line?: number;
}

export interface FileRef {
  path: string;
  line?: number;
}

const WIN_ABS = /^[A-Za-z]:[\\/]/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LINE_SUFFIX = /(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)$/;
const HAS_EXT = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const BAD_CHARS = /[*?<>|"\n\r\0]/;
const WIN_DRIVE = /^[A-Za-z]:/;
const UNC = /^[\\/]{2}/;
const SEP = /[\\/]/;
// A bare `console.log` / `process.env` is code, not a file: separator-less names
// must carry a code/doc extension from the recognized list.
const BARE_OK = new Set(RECOGNIZED_EXTENSIONS);

export function isAbsolutePath(p: string): boolean {
  return WIN_ABS.test(p) || p.startsWith("/");
}

/** Text -> file reference, or null when it does not look like a file path. */
export function parseFileRef(raw: string, opts: { decode?: boolean } = {}): FileRef | null {
  let s = raw.trim();
  if (!s || s.length > 1024 || BAD_CHARS.test(s) || s.startsWith("#")) return null;
  let decode = opts.decode === true;
  if (/^file:\/\//i.test(s)) {
    if (!/^file:\/\/\//i.test(s)) return null; // a host/authority (UNC share) is never a local file
    s = s.replace(/^file:\/\/\//i, "");
    if (!WIN_ABS.test(s)) s = `/${s}`;
    decode = true;
  } else if (SCHEME.test(s) && !WIN_ABS.test(s)) {
    return null; // http:, https:, mailto:, ... — real links stay links
  }
  if (decode) {
    try {
      s = decodeURIComponent(s);
      if (BAD_CHARS.test(s)) return null; // %00 / %0A decode into what the raw check rejects
    } catch {
      return null;
    }
  }
  let line: number | undefined;
  const m = LINE_SUFFIX.exec(s);
  if (m) {
    line = Number(m[1] ?? m[2]);
    s = s.slice(0, m.index);
  }
  if (UNC.test(s)) return null; // UNC / device namespaces
  if ((WIN_DRIVE.test(s) ? s.slice(2) : s).includes(":")) return null; // NTFS alternate data streams
  const abs = isAbsolutePath(s);
  if (!abs && !decode && /\s/.test(s)) return null; // spaces only via an (encoded) link href
  if (!abs) {
    s = s.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
    if (s.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) return null;
  } else if (s.split(SEP).some((seg) => seg === ".." || seg === ".")) {
    return null; // absolute traversal is never a chip either
  }
  const name = s.split(SEP).pop() ?? "";
  if (!HAS_EXT.test(name)) return null;
  if (!SEP.test(s)) {
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    if (!BARE_OK.has(ext)) return null;
  }
  return line ? { path: s, line } : { path: s };
}

/** Absolute path -> target (project-relative when it lies under the root). */
export function targetForAbsolute(abs: string, projectRoot: string | null, line?: number): ViewerTarget {
  const rel = projectRoot ? relativeToCwd(abs, projectRoot) : null;
  const t: ViewerTarget = rel ? { path: rel, outside: false } : { path: abs, outside: true };
  return line ? { ...t, line } : t;
}

/**
 * File reference -> target; null when it cannot be located. A RELATIVE path is relative to the
 * directory the session ran in (`cwd` — the model writes paths from there, which for an iterate
 * worktree or a subfolder task is not the project root); without a cwd it falls back to the root.
 */
export function resolveViewerTarget(ref: FileRef, projectRoot: string | null, cwd: string | null = null): ViewerTarget | null {
  if (isAbsolutePath(ref.path)) return targetForAbsolute(ref.path, projectRoot, ref.line);
  const base = cwd || projectRoot;
  if (!base) return null;
  const back = base.includes("\\") && !base.includes("/");
  const rel = back ? ref.path.replace(/\//g, "\\") : ref.path;
  return targetForAbsolute(`${base.replace(/[\\/]+$/, "")}${back ? "\\" : "/"}${rel}`, projectRoot, ref.line);
}

/** Convenience for renderers: raw text -> target. */
export function targetFromText(raw: string, projectRoot: string | null, opts?: { decode?: boolean; cwd?: string | null }): ViewerTarget | null {
  const ref = parseFileRef(raw, opts);
  return ref ? resolveViewerTarget(ref, projectRoot, opts?.cwd ?? null) : null;
}

/** The full filesystem path a target stands for: outside targets are already absolute;
 *  an inside (root-relative) one is joined onto the project root in the root's own style. */
export function fullPathOf(target: ViewerTarget, projectRoot: string | null): string {
  if (target.outside || !projectRoot) return target.path;
  const back = projectRoot.includes("\\") && !projectRoot.includes("/");
  const root = projectRoot.replace(/[\\/]+$/, "");
  return back ? `${root}\\${target.path.replace(/\//g, "\\")}` : `${root}/${target.path}`;
}
