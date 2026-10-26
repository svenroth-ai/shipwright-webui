/*
 * custom-profile-command-policy.ts — command policy for custom Preview profiles.
 * Split out of custom-profile-loader.ts (300-line cap). A PROJECT-source command
 * must be a bare allowlisted runner; a USER-source one may be any bare program or
 * absolute path, never one pointing into the repo. Pure functions, no I/O beyond
 * realpath of the program being checked.
 */

import { realpathSync } from "node:fs";
import path from "node:path";

import { PreviewSessionManager } from "./preview-session-manager.js";

// `npx` is deliberately absent: it downloads and runs a package the repo names.
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "node", "vite", "next", "python", "python3", "uv", "deno"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SCRIPT_VERBS = new Set(["run", "run-script", "dev", "start", "serve", "preview"]);
// Interpreters take code from flags (-e, --eval=, -cprint, -Ic, --import data:...),
// subcommands (deno eval, -m) and URLs. For these the only accepted shape is
// "runner + plain file argument(s)": any dash-led argument, `eval`, or URL is refused.
const INTERPRETERS = new Set(["node", "python", "python3", "deno", "uv"]);


/** Project-source command policy. Returns a refusal reason, or null when allowed. */
export function projectCommandRefusal(command: string): string | null {
  let argv: string[];
  try {
    argv = PreviewSessionManager.tokenizeCommand(command);
  } catch (err) {
    return err instanceof Error ? err.message : "unparseable command";
  }
  const exe = argv[0] ?? "";
  if (/[\\/:]/.test(exe)) return "a project profile may not run a path or a program inside the repo";
  const name = exe.toLowerCase().replace(/\.(cmd|exe|bat)$/, "");
  if (!RUNNERS.has(name)) return `“${exe}” is not an allowed runner for a project profile`;
  const args = argv.slice(1);
  const argRefusal = runnerArgRefusal(args);
  if (argRefusal) return argRefusal;
  if (PACKAGE_MANAGERS.has(name)) {
    // Run a script the repo's own package.json declares - the same trust as `npm run dev`.
    // exec / dlx / x / create fetch and run a package; -e / -c run inline code.
    if (!SCRIPT_VERBS.has((args[0] ?? "").toLowerCase())) return "a project profile may only run a package script (run, dev, start)";
    const verb = (args[0] ?? "").toLowerCase();
    const script = verb === "run" || verb === "run-script" ? (args[1] ?? "") : "dev";
    if (!script || script.startsWith("-") || /^[a-z][a-z0-9+.-]*:/i.test(script) || /[\\/]/.test(script)) {
      return "a project profile must name a plain package script";
    }
  }
  if (INTERPRETERS.has(name)) {
    if (args.some((a) => a.startsWith("-") || a.toLowerCase() === "eval" || /^[a-z][a-z0-9+.-]*:/i.test(a))) {
      return "flags, eval and URLs are not allowed for an interpreter in a project profile";
    }
    // a script INSIDE the repo only: no absolute / drive / UNC / parent-relative file argument
    if (args.some((a) => /^([\\/]|[a-z]:)/i.test(a) || a.split(/[\\/]/).includes(".."))) {
      return "an interpreter may only run a script inside the project";
    }
    if (name === "uv" && (args[0] !== "run" || INTERPRETERS.has((args[1] ?? "").toLowerCase().replace(/\.(cmd|exe|bat)$/, "")))) {
      return "uv may only run a script file in a project profile";
    }
  }
  return null;
}

/** User-source: any bare program, or an ABSOLUTE path - never a path relative to the repo. */
export function userCommandRefusal(command: string, projectPath = ""): string | null {
  let argv: string[];
  try {
    argv = PreviewSessionManager.tokenizeCommand(command);
  } catch (err) {
    return err instanceof Error ? err.message : "unparseable command";
  }
  const exe = argv[0] ?? "";
  if (/[\\/]/.test(exe) && !path.isAbsolute(exe)) return "a profile command must be a bare program or an absolute path";
  // an absolute path that points INTO the repository is the same thing as a repo-relative one
  if (projectPath && path.isAbsolute(exe)) {
    let root = projectPath;
    let target = exe;
    try {
      root = realpathSync(projectPath);
      target = realpathSync(exe);
    } catch {
      // a program that does not exist yet cannot be resolved - compare the literal paths
    }
    if (contained(root, target) || contained(path.resolve(projectPath), path.resolve(exe))) {
      return "a profile command may not point into the project";
    }
  }
  return null;
}

/** Arguments no runner may take: a path out of the project, a URL, or a config/eval flag. */
function runnerArgRefusal(args: string[]): string | null {
  for (const a of args) {
    if (/^([\\/]|[a-z]:)/i.test(a) || a.split(/[\\/]/).includes("..")) return "a project profile argument may not be an absolute path or leave the project";
    if (/^[a-z][a-z0-9+.-]*:/i.test(a) && !/^[a-z]:[\\/]/i.test(a)) return "a project profile argument may not be a URL";
    const flag = a.toLowerCase().split("=")[0];
    if (["-c", "--config", "-e", "--eval", "--print", "--require", "-r", "--import", "--loader", "--input-type"].includes(flag ?? "")) {
      return "config, eval and preload flags are not allowed in a project profile";
    }
  }
  return null;
}

export function contained(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}
