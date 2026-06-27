// Shell-specific argument escaping for the three launch shells (PowerShell,
// cmd.exe, POSIX).
//
// Extracted from launcher.ts (iterate-2026-06-27-codeql-hardening) to keep that
// file under the 300-LOC limit and make the quoters independently testable.
// `core/actions-substitute.ts` calls them per target shell before substituting
// user-derived placeholders into command templates; the shell-escape discipline
// is the security boundary for command-template substitution (plan.md § 2.2).
// launcher.ts re-exports these, so existing `from "./launcher.js"` importers
// keep working. Do not move this logic behind a different abstraction without
// updating `actions-substitute.ts`.

export function qPs(v: string): string {
  // PS single-quoted: embedded `'` → `''`.
  return `'${v.replace(/'/g, "''")}'`;
}

export function qCmd(v: string): string {
  // cmd.exe double-quoted argument, escaped per CommandLineToArgvW (the prior
  // `"${v.replace(/"/g,'\\"')}"` left backslashes unescaped — CodeQL
  // js/incomplete-sanitization #4): N `\` before an embedded `"` → 2N+1 `\`+`"`;
  // N `\` before the CLOSING quote → 2N `\` (a trailing `\` can't escape it);
  // `\` not before a quote stays literal (`C:\foo` must not become `C:\\foo`).
  // Argv layer only; cmd.exe metachar handling is out of scope on this
  // loopback tool (inputs aren't cross-user-trust; `qPs` is the default shell).
  let out = '"';
  let pendingBackslashes = 0;
  for (const ch of v) {
    if (ch === "\\") {
      pendingBackslashes += 1;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(pendingBackslashes * 2 + 1) + '"';
    } else {
      out += "\\".repeat(pendingBackslashes) + ch;
    }
    pendingBackslashes = 0;
  }
  out += "\\".repeat(pendingBackslashes * 2) + '"';
  return out;
}

export function qPosix(v: string): string {
  // POSIX single-quoted: `'` → `'\''`.
  return `'${v.replace(/'/g, "'\\''")}'`;
}

export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}
