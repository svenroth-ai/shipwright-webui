/*
 * external/tasks/fork.ts — POST /tasks/:id/fork.
 *
 * Split out of lifecycle.ts (Codextender integration file-size cleanup,
 * 2026-09-23 — lifecycle.ts crossed the 300-line guideline) so each file
 * stays a single concern. Clone a task with a parent linkage + emit fresh
 * launch commands. Fork bypasses the main launch chokepoint (§2.1's
 * correction) entirely — it has its own AC8-equivalent CLI/proxy preflight
 * and its own runtime/integration-mode inheritance, mirroring but never
 * calling `runtime-chokepoint.ts`.
 */

import type { Hono } from "hono";

import { existsSync } from "node:fs";
import path from "node:path";

import {
  probeCodextenderLiveness,
  resolveCodextenderMaxContextTokens,
} from "../../core/codextender-proxy-probe.js";
import { buildCopyCommands } from "../../core/launcher.js";
import { buildCodexCommands } from "../../core/launcher-codex.js";
import {
  buildCodextenderCommands,
  resolveCodextenderAuthToken,
} from "../../core/launcher-codextender.js";
import { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import { normalizeTitle, withLiveSession } from "../_shared/helpers.js";
import { isCodexCliAvailable, runtimeForTask } from "../launch/runtime-chokepoint.js";
import {
  codexCliNotFoundError,
  codextenderAuthTokenMissingError,
  codextenderProxyUnreachableError,
} from "../launch/runtime-chokepoint-errors.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export function registerTasksFork(
  app: Hono,
  deps: {
    store: SdkSessionsStore;
    ptyManager: { get(taskId: string): unknown };
    /** Codex Light §2.1 — resolves the parent's project for the fork's AGENTS.md check. */
    getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
    /** Test seam — defaults to a real `codex --version` probe. */
    checkCodexCliAvailable?: () => Promise<boolean>;
    /** Codextender integration Part B.6 — test seam for the fork route's
     *  own AC8-equivalent preflight when the parent is a Codextender task.
     *  Defaults to a real `GET /health/liveliness` probe of the proxy
     *  (no auth required). */
    checkCodextenderProxyAvailable?: () => Promise<boolean>;
    /** The `codextenderPort` global setting; defaults to 4000. */
    getCodextenderPort?: () => Promise<number | undefined>;
    /** Test seam — defaults to `resolveCodextenderAuthToken()` (reads
     *  `process.env.CODEXTENDER_AUTH_TOKEN`, no built-in fallback). */
    getCodextenderAuthToken?: () => string | undefined;
    /** Test seam — defaults to a real probe of the proxy's `/v1/models` for
     *  the default alias's `max_input_tokens` (operator finding,
     *  2026-09-26) — a fork never has a per-launch model override to pass,
     *  same as `buildCodextenderCommands`'s own default resolution. */
    getCodextenderMaxContextTokens?: (port: number) => Promise<number | undefined>;
  },
): void {
  const {
    store,
    ptyManager,
    getProjectById,
    checkCodexCliAvailable = isCodexCliAvailable,
    checkCodextenderProxyAvailable,
    getCodextenderPort,
    getCodextenderMaxContextTokens = (port: number) =>
      resolveCodextenderMaxContextTokens(port, undefined),
    getCodextenderAuthToken = resolveCodextenderAuthToken,
  } = deps;

  app.post("/api/external/tasks/:id/fork", async (c) => {
    const parent = store.get(c.req.param("id"));
    if (!parent) return c.json({ error: "Parent task not found" }, 404);
    // Doubt-review HIGH — `store.get()` returns the live, shared task
    // object, and `store.patch()` mutates it in place (e.g. a concurrent
    // relaunch of the parent in another tab). This handler awaits multiple
    // times (settings read, CLI/proxy probe, store.create); re-reading
    // `parent.runtime`/`parent.codexIntegrationMode` after each await could
    // observe a DIFFERENT value than the preflight branch above already
    // committed to, silently skipping the CLI/proxy check the later branch
    // assumed already ran. Snapshot both fields ONCE, before the first
    // await, and use only these locals for the rest of the handler.
    const parentRuntime = parent.runtime;
    const parentCodexIntegrationMode = parent.codexIntegrationMode;
    const body = await c.req.json().catch(() => ({}));
    // D22/F27 — validate a PROVIDED (non-blank) title with PATCH's own rule
    // BEFORE creating the child (no orphan row on an invalid title). Absent/
    // blank keeps the "<parent> — fork" default.
    let title = `${parent.title} — fork`;
    if (typeof body.title === "string" && body.title.trim()) {
      const r = normalizeTitle(body.title);
      if (!r.ok) return c.json({ error: r.error }, 400);
      title = r.value;
    }
    // AC8 (PR-review preflight finding) — fork bypasses the main chokepoint
    // (§2.1's correction), so it needs its own CLI check, before store.create
    // like the title validation above (no orphan child row).
    //
    // Codextender integration Part B.6 — a Codextender-mode parent (parent.
    // codexIntegrationMode is stamped at the PARENT's own launch, so it's
    // already known here — no fresh-settings read needed the way the launch
    // chokepoint requires) drives ordinary `claude`, so the relevant
    // preflight is the proxy probe, not `codex --version`.
    //
    // The port read is scoped to this branch (not hoisted above the `if`)
    // so the common case — forking an ordinary Claude-runtime task — never
    // pays for a settings read whose result it would discard.
    let codextenderPort: number | undefined;
    let codextenderAuthToken: string | undefined;
    let codextenderMaxContextTokens: number | undefined;
    if (parentRuntime === "codex" && parentCodexIntegrationMode === "codextender") {
      codextenderPort = (await getCodextenderPort?.()) ?? 4000;
      const proxyOk = checkCodextenderProxyAvailable
        ? await checkCodextenderProxyAvailable()
        : await probeCodextenderLiveness(codextenderPort);
      if (!proxyOk) {
        return c.json(codextenderProxyUnreachableError(codextenderPort), 400);
      }
      codextenderAuthToken = getCodextenderAuthToken();
      if (!codextenderAuthToken) {
        return c.json(codextenderAuthTokenMissingError(), 400);
      }
      codextenderMaxContextTokens = await getCodextenderMaxContextTokens(codextenderPort);
    } else if (parentRuntime === "codex" && !(await checkCodexCliAvailable())) {
      return c.json(codexCliNotFoundError(), 400);
    }
    const child = store.create({
      title,
      cwd: parent.cwd,
      pluginDirs: parent.pluginDirs,
      parentTaskId: parent.taskId,
      parentSessionUuid: parent.sessionUuid,
      // Section 02 — forks inherit the parent's projectId.
      projectId: parent.projectId,
      // Codex Light §2.1's correction — fork does NOT share the main
      // chokepoint; a forked task must inherit the parent's runtime here,
      // explicitly, or it silently becomes a Claude task. Uses the snapshot
      // taken above the preflight, not a fresh `parent.runtime` re-read.
      runtime: parentRuntime,
    });
    let commands;
    if (runtimeForTask(child) === "codex" && parentCodexIntegrationMode === "codextender") {
      // Codextender integration Part B.6 — same "reuse the plain-Claude fork
      // commands, prepend the env-var prefix" pattern the launch chokepoint
      // uses (launcher-codextender.ts's own doc comment).
      const plainForkCommands = buildCopyCommands({
        sessionUuid: child.sessionUuid,
        cwd: child.cwd,
        fork: true,
        parentSessionUuid: parent.sessionUuid,
        pluginDirs: child.pluginDirs,
        title: child.title,
      });
      commands = buildCodextenderCommands({
        cwd: child.cwd,
        // `codextenderPort`/`codextenderAuthToken` are always set on this
        // path — the same `parentCodexIntegrationMode === "codextender"`
        // guard above assigned both (both branches now read the same
        // snapshot local, so this invariant can no longer be defeated by a
        // concurrent mutation of the live `parent` object between the two
        // checks). The `?? 4000` / `!` are unreachable-but-safe, not real
        // fallbacks — the auth-token preflight above already returned 400
        // if it were missing.
        baseUrl: `http://127.0.0.1:${codextenderPort ?? 4000}`,
        authToken: codextenderAuthToken!,
        claudeCommands: plainForkCommands,
        maxContextTokens: codextenderMaxContextTokens,
      });
    } else if (runtimeForTask(child) === "codex") {
      const hasAgentsMd = Boolean(
        getProjectById &&
          getProjectById(child.projectId)?.path &&
          existsSync(
            path.join(getProjectById(child.projectId)!.path || "", "AGENTS.md"),
          ),
      );
      commands = buildCodexCommands({
        cwd: child.cwd,
        autonomy: parent.autonomy ?? "guided",
        resume: false,
        phase: parent.phase,
        description: parent.description,
        hasAgentsMd,
      });
    } else {
      commands = buildCopyCommands({
        sessionUuid: child.sessionUuid,
        cwd: child.cwd,
        fork: true,
        parentSessionUuid: parent.sessionUuid,
        pluginDirs: child.pluginDirs,
        title: child.title,
      });
    }
    store.patch(child.taskId, {
      state: "awaiting_external_start",
      launchedAt: new Date().toISOString(),
      // Codextender integration Part B.6 — a forked task inherits the
      // PARENT's already-established integration mode (mirrors `runtime:
      // parentRuntime` at store.create above), never today's global
      // setting, which may have changed since the parent's own launch —
      // and never a fresh `parent.codexIntegrationMode` re-read, which
      // could now disagree with the preflight that already ran above.
      codexIntegrationMode: parentCodexIntegrationMode,
    });
    await store.persist();
    return c.json({
      task: withLiveSession(store.get(child.taskId), ptyManager),
      commands,
    });
  });
}
