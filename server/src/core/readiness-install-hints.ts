/*
 * readiness-install-hints — OS-aware install commands for a missing toolchain
 * prerequisite (FR-01.51). Split out of readiness-probe.ts to keep that file
 * under the 300-LOC guideline, and because "how to install a tool" is a distinct
 * concern from "is it ready" — the same split the bootstrapper makes (its
 * `installHint` lives in `bootstrapper/lib/util.mjs`, apart from preflight.mjs).
 *
 * This is the SERVER MIRROR of that helper, not a cross-package import (CLAUDE.md
 * rule 7 / DO-NOT #7 — no cross-package imports; the two are kept as verbatim
 * mirrors). The distinction that makes it necessary: `npx @svenroth-ai/shipwright`
 * (the readiness repair command) installs the Shipwright PLUGINS + CACHE, it does
 * NOT install claude/uv/python/git — so a missing tool must print its own
 * OS-correct line, never "re-run npx" (the defect this fixes).
 */

/** A tool the repair command cannot install — it needs its own command. */
export type ToolchainTool = "claude" | "uv" | "python" | "git";

/**
 * Platform-correct, copy-pasteable install command for a missing prerequisite.
 * Mirrors `bootstrapper/lib/util.mjs installHint` field-for-field.
 */
export function installHint(tool: ToolchainTool, platform: NodeJS.Platform): string {
  const win = platform === "win32";
  switch (tool) {
    case "uv":
      return win
        ? 'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'
        : "curl -LsSf https://astral.sh/uv/install.sh | sh";
    case "python":
      // Coupled to uv: the whole stack runs via `uv run`, which resolves a
      // uv-MANAGED Python — a system python3 is neither required nor sufficient.
      // Lead with the uv path; the OS package manager / python.org is the fallback.
      return win
        ? "install Python 3.11+ via uv (`uv python install 3.11`) — or from https://www.python.org/downloads/ (NOT the Microsoft Store stub)"
        : "install Python 3.11+ via uv (`uv python install 3.11`) — or your package manager (e.g. `brew install python@3.11`)";
    case "git":
      return win
        ? "install Git from https://git-scm.com/download/win"
        : "install git (e.g. `brew install git` / `apt install git`)";
    case "claude":
      return win
        ? 'powershell -c "irm https://claude.ai/install.ps1 | iex"'
        : "curl -fsSL https://claude.ai/install.sh | bash";
  }
}
