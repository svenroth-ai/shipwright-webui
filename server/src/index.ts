/*
 * Shipwright Command Center — server entry.
 *
 * Plan D'' variant-a architecture (external-launch):
 *   - Webui owns no Claude subprocess, no SSE chat stream, no NDJSON parser.
 *   - User launches Claude Code in their own terminal via a pre-bound
 *     --session-id UUID (copy-command generator at core/launcher.ts).
 *   - Webui observes the JSONL at ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
 *     via SessionWatcher + polling (core/session-watcher.ts).
 *   - Task metadata persisted at <registryDir>/sdk-sessions.json
 *     (core/sdk-sessions-store.ts).
 *
 * This file used to be 800+ LOC of chat/adapter/heartbeat wiring.
 * Sub-iterate 3 of Plan D'' trims it to ~100 LOC.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import fs from "fs";
import { readFile, writeFile } from "fs/promises";
import { execSync } from "node:child_process";
import * as lockfile from "proper-lockfile";

import { getConfig } from "./config.js";
import { formatBindError } from "./lib/bind-errors.js";
import { resolveHonoHost } from "./lib/resolveHonoHost.js";
import { resolveTrustedOrigins } from "./lib/resolveTrustedOrigins.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/logger.js";
import { ProjectManager } from "./core/project-manager.js";
import { SdkSessionsStore } from "./core/sdk-sessions-store.js";
import { SessionWatcher } from "./core/session-watcher.js";
import {
  probeClaudeVersion,
  resolveClaudeBin,
  selfHealClaudePath,
  type ClaudeVersionInfo,
} from "./core/cli-compat.js";
import { PreviewSessionManager } from "./core/preview-session-manager.js";
import {
  loadProfile as loadProfileReal,
  getProfilesDir,
} from "./core/profile-loader.js";

import { createProjectRoutes } from "./routes/projects.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { createProfilesRoutes } from "./routes/profiles.js";
import { createExternalRoutes } from "./external/routes.js";
import { createDiagnosticsRoutes } from "./routes/diagnostics.js";
import { createTriageRoutes } from "./routes/triage.js";
import { createCampaignsRoutes } from "./routes/campaigns.js";
import { resolveCampaignsDir } from "./core/campaign-paths.js";
import { readCampaigns } from "./core/campaign-store.js";
import { createTriageLock } from "./core/triage-lock.js";
import { PtyManager } from "./terminal/pty-manager.js";
import {
  createTerminalRoutes,
  createNodePtySpawnFn,
} from "./terminal/routes.js";
import { ScrollbackStore } from "./terminal/scrollback-store.js";
import { SnapshotStore } from "./terminal/snapshot-store.js";
import { runBootWipe } from "./terminal/boot-wipe.js";
import { probeHeadlessDeps } from "./terminal/headless-probe.js";
import { createNodeWebSocket } from "@hono/node-ws";

const config = getConfig();
const startTime = Date.now();

export const app = new Hono();

// Iterate v0.8.4 — CORS origin gate now defers to
// `resolveTrustedOrigins(process.env)` so it widens consistently with
// `HONO_HOST` / `WEBUI_TRUSTED_ORIGINS`. Same policy as the WS upgrade
// gate in `terminal/routes.ts`. Default (no env vars set) is
// loopback-only — and stricter than the prior `origin.includes("localhost")`
// substring check, which would have matched
// `http://evil-localhost-attack.com`.
//
// ADR-083 — pass tailscaleExec so SHIPWRIGHT_NETWORK_PROFILE=tailscale
// drives the policy too (loopback + tailscale-IP + *.ts.net allowed).
const tailscaleExecForOrigin = (cmd: string, opts?: object) =>
  String(execSync(cmd, opts as Parameters<typeof execSync>[1]));
const corsOriginPolicy = resolveTrustedOrigins(
  process.env,
  tailscaleExecForOrigin,
);
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (origin && corsOriginPolicy.isAllowed(origin)) return origin;
      return null;
    },
  }),
);
app.use("*", requestLogger);
app.onError(errorHandler);

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    version: "0.1.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
  }),
);

const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"));

if (isMainModule) {
  void (async () => {
    try {
      const FATAL_ERROR_CODES = new Set(["EADDRINUSE", "EACCES", "EADDRNOTAVAIL"]);
      process.on("uncaughtException", (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        if (code && FATAL_ERROR_CODES.has(code)) {
          console.error(
            JSON.stringify({
              level: "fatal",
              message: `Fatal startup error (${code}) — exiting so tsx watch can retry`,
              error: String(err),
              code,
            }),
          );
          process.exit(1);
        }
        console.error(
          JSON.stringify({
            level: "error",
            message: "Uncaught exception (server stays alive)",
            error: String(err),
            stack: err.stack,
          }),
        );
      });
      process.on("unhandledRejection", (reason) => {
        console.error(
          JSON.stringify({
            level: "error",
            message: "Unhandled rejection (server stays alive)",
            error: String(reason),
          }),
        );
      });

      // Shared cross-process lock + file-exists guard.
      const lockPath = async (p: string) => lockfile.lock(p, { retries: 3 });
      const ensureFileExists = (p: string) => {
        if (!fs.existsSync(p)) fs.writeFileSync(p, "");
      };

      // ProjectManager — still used by /api/projects + wizard.
      // getTaskProjectIds (section 02) is late-bound below, after the
      // sessionsStore is constructed.
      const projectManagerDeps: {
        readFile: (p: string, e: string) => Promise<string>;
        writeFile: (p: string, d: string) => Promise<void>;
        existsSync: (p: string) => boolean;
        mkdirSync: (p: string, o?: { recursive: boolean }) => void;
        readdirSync: (p: string, o?: { withFileTypes: boolean }) => Array<{ name: string; isDirectory: () => boolean }>;
        lock: (p: string) => Promise<() => Promise<void>>;
        ensureFile: (p: string) => void;
        getTaskProjectIds?: () => Set<string>;
      } = {
        readFile: (p: string, e: string) => readFile(p, e as BufferEncoding),
        writeFile: (p: string, d: string) => writeFile(p, d),
        existsSync: (p: string) => fs.existsSync(p),
        mkdirSync: (p: string, o?: { recursive: boolean }) => fs.mkdirSync(p, o),
        readdirSync: ((p: string, o?: { withFileTypes: boolean }) =>
          fs.readdirSync(p, o as unknown as { withFileTypes: true })) as (
          p: string,
          o?: { withFileTypes: boolean },
        ) => Array<{ name: string; isDirectory: () => boolean }>,
        lock: lockPath,
        ensureFile: ensureFileExists,
      };
      const projectManager = new ProjectManager(
        `${config.registryDir}/projects.json`,
        projectManagerDeps,
      );
      await projectManager.load();

      // External-launch store + watcher.
      //
      // Section 02 (iterate 3, ADR-037/038) — two cross-wirings:
      //   1. projectManager.getTaskProjectIds reads from sessionsStore so
      //      the Unassigned pseudo-project surfaces iff any task needs it.
      //   2. sdkSessionsStore.getKnownProjectIds reads from projectManager
      //      so stale projectIds on-disk (deleted projects, O26) resolve
      //      to UNASSIGNED in memory on load.
      //
      // The wiring order matters — projectManager loads first (sync
      // projects.json read) and the sessionsStore reads from it during
      // its own load(). The sessionsStore is created fresh above so we
      // pass a reference-equality callback that stays valid after both
      // stores finish loading.
      const sdkSessionsPath = `${config.registryDir}/sdk-sessions.json`;
      const sdkSessionsDeps = {
        readFile: (p: string, e: string) => readFile(p, e as BufferEncoding),
        writeFile: (p: string, d: string) => writeFile(p, d),
        existsSync: (p: string) => fs.existsSync(p),
        mkdirSync: (p: string, o?: { recursive: boolean }) => fs.mkdirSync(p, o),
        lock: lockPath,
        ensureFile: ensureFileExists,
        getKnownProjectIds: () => new Set(projectManager.getAll().filter((p) => !p.synthesized).map((p) => p.id)),
      };
      const sdkSessionsStore = new SdkSessionsStore(sdkSessionsPath, sdkSessionsDeps);
      await sdkSessionsStore.load();

      // Late-bind getTaskProjectIds on the already-constructed
      // projectManager — its deps shape is public (mutable fields), so we
      // append here rather than threading through constructor args above.
      (projectManager as unknown as { deps: { getTaskProjectIds: () => Set<string> } }).deps.getTaskProjectIds =
        () => new Set(sdkSessionsStore.list().map((t) => t.projectId));

      // Boot-time diagnostic (spec step 7). Logs once if any session
      // carries projectId="unassigned" while the on-disk file is still
      // schemaVersion: 1 — confirms the write-on-touch migration is
      // deferred as designed (ADR-038) rather than silently broken.
      try {
        if (fs.existsSync(sdkSessionsPath)) {
          const raw = fs.readFileSync(sdkSessionsPath, "utf-8");
          if (raw.trim()) {
            const parsed = JSON.parse(raw) as { schemaVersion?: number };
            const hasUnassignedInMemory = sdkSessionsStore
              .list()
              .some((t) => t.projectId === "unassigned");
            if (parsed.schemaVersion === 1 && hasUnassignedInMemory) {
              console.log(
                JSON.stringify({
                  level: "info",
                  message:
                    "sdk-sessions.json is still schemaVersion 1; v1→v2 migration will land on next task mutation (ADR-038)",
                }),
              );
            }
          }
        }
      } catch {
        // Non-fatal — the diagnostic is purely informational.
      }

      const sessionWatcher = new SessionWatcher();

      // Claude CLI version probe (refreshed on demand; post-upgrade clients
      // see the new number without a server restart).
      let claudeVersion: ClaudeVersionInfo = probeClaudeVersion();

      // iterate-2026-05-08 v0.8.8 AC-3 — boot-time PATH self-heal. When
      // the AC-2 fallback resolved a binary that's NOT on the server's
      // process.env.PATH (typical: claude installed into ~/.local/bin/
      // but server started from a shell whose PATH didn't include that
      // dir), prepend the parent dir so subsequent child-process spawns
      // (node-pty pwsh / preview-session-manager) inherit the augmented
      // PATH. Idempotent — no-op when parent dir is already on PATH.
      const resolvedBin = resolveClaudeBin();
      selfHealClaudePath({
        bin: resolvedBin,
        env: process.env,
        platform: process.platform,
      });

      const versionInfo = (): ClaudeVersionInfo => {
        if (!claudeVersion.raw) claudeVersion = probeClaudeVersion();
        return claudeVersion;
      };

      // Mount routes.
      const settingsPath = `${config.registryDir}/settings.json`;
      const settingsDeps = {
        readFile: (p: string, e: string) => readFile(p, e as BufferEncoding),
        writeFile: (p: string, d: string) => writeFile(p, d),
        existsSync: (p: string) => fs.existsSync(p),
        mkdirSync: (p: string, o?: { recursive: boolean }) => fs.mkdirSync(p, o),
        lock: lockPath,
        ensureFile: ensureFileExists,
      };
      const projectFsDeps = {
        existsSync: (p: string) => fs.existsSync(p),
        mkdirSync: (p: string, o?: { recursive: boolean }) => fs.mkdirSync(p, o),
        writeFileSync: (p: string, d: string) => fs.writeFileSync(p, d),
        renameSync: (from: string, to: string) => fs.renameSync(from, to),
      };
      app.route("/", createProjectRoutes(projectManager, projectFsDeps));
      app.route("/", createSettingsRoutes(settingsPath, settingsDeps));
      app.route("/", createProfilesRoutes());
      // Section 03 (iterate 3) — preview-session manager. Single instance
      // per server process so the dedup map lives across requests. Its
      // killAll() runs on shutdown so user-spawned dev servers don't
      // linger past a webui restart.
      const previewManager = new PreviewSessionManager();

      // Iterate 5 (ADR-068-A1) — disk-backed terminal scrollback. Single
      // ScrollbackStore instance shared between PtyManager (append on
      // pty.onData + closeStream on kill) and the WS replay flow in
      // terminal/routes.ts. Boot-time init() creates the dir + caches
      // the realpath; sweep runs on boot AND on a 24h interval.
      const scrollbackStore = new ScrollbackStore(config.terminalScrollbackDir, {
        maxBytesPerTask: config.terminalScrollbackMaxBytes,
      });
      try {
        await scrollbackStore.init();
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message:
              "scrollback store init failed; persistence disabled this session",
            error: String(err).slice(0, 200),
          }),
        );
      }

      // Iterate C (ADR-087) — one-shot wipe of legacy `*.log*` files.
      // The chunked-replay path is retired in this iterate; the on-disk
      // scrollback files have no replay consumer. Wipe them once,
      // mark the directory, never wipe again. Idempotency marker
      // protects against repeat-runs. Best-effort; boot continues on
      // failure. Snapshot files (`.snapshot`) are PRESERVED.
      try {
        const wipeResult = await runBootWipe({
          dir: config.terminalScrollbackDir,
        });
        if (wipeResult.deleted > 0 || wipeResult.errors > 0) {
          console.log(
            JSON.stringify({
              level: "info",
              message: "iterate-C scrollback wipe",
              deleted: wipeResult.deleted,
              errors: wipeResult.errors,
              markerWritten: wipeResult.markerWritten,
            }),
          );
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "iterate-C scrollback wipe threw; continuing boot",
            error: String(err).slice(0, 200),
          }),
        );
      }

      // Iterate C (ADR-087, MEDIUM-B2 fix) — pre-probe @xterm/headless +
      // @xterm/addon-serialize via dynamic import. On failure, downgrade
      // headlessMirrorEnabled=false so the server boots cleanly without
      // snapshots (rather than crashing on the static ESM import at
      // load time). Trade-off documented in ADR-087: without snapshots
      // the client sees a blank terminal with a live shell.
      const headlessProbe = await probeHeadlessDeps();
      if (!headlessProbe.ok) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message:
              "headless-mirror dependencies missing; mirror disabled this session (ADR-087 MEDIUM-B2 graceful fallback)",
            reason: headlessProbe.reason,
          }),
        );
      }
      const headlessMirrorEnabledEffective =
        config.terminalHeadlessMirror && headlessProbe.ok;

      // Iterate-2026-05-11 (ADR-088) — server-side @xterm/headless mirror
      // snapshots. SnapshotStore shares the scrollback directory but
      // owns a separate `.snapshot` extension so the existing rotation
      // / sweep machinery is undisturbed. Init is best-effort; failure
      // logs and disables mirror.
      const snapshotStore = new SnapshotStore(config.terminalScrollbackDir);
      let snapshotStoreReady = false;
      if (headlessMirrorEnabledEffective) {
        try {
          await snapshotStore.init();
          snapshotStoreReady = true;
        } catch (err) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message:
                "snapshot store init failed; headless-mirror disabled this session",
              error: String(err).slice(0, 200),
            }),
          );
        }
      }
      // Iterate 4 (ADR-067) — embedded-terminal pty manager.
      // PtyManager owns shell-pty lifecycle (Plan-D''-conform: shells only,
      // never `claude`). Construction is async because the @lydell/node-pty
      // backend is dynamically imported so unit tests don't pull in the
      // native binary.
      const ptyManager = new PtyManager({
        spawn: await createNodePtySpawnFn(),
        wsBufferBytes: config.terminalWsBufferBytes,
        idleTimeoutMs: config.terminalIdleTimeoutMs,
        scrollbackStore,
        // ADR-088 — wire the headless mirror only when both the env
        // flag is set AND the snapshot store initialised successfully.
        // Either alone is a no-op (see PtyManager constructor; mirror
        // requires both signals).
        // Iterate C (ADR-087, MEDIUM-B2) — `headlessMirrorEnabledEffective`
        // additionally captures the dynamic-import probe result so a
        // missing `@xterm/headless` package downgrades cleanly here.
        headlessMirrorEnabled:
          headlessMirrorEnabledEffective && snapshotStoreReady,
        snapshotStore: snapshotStoreReady ? snapshotStore : undefined,
        // ADR-092 (Iterate E) — pinned @xterm/headless version. Used by
        // serializeMirrorIfLive() so the in-memory SnapshotRecord
        // returned to the WS replay path carries the same
        // terminalVersion the disk-side gate (tryReadSnapshot) expects.
        // The probe is the primary source; fs-fallback for
        // expectedTerminalVersion happens further below (kept as a
        // defensive secondary path for the disk-read gate).
        expectedTerminalVersion: headlessProbe.terminalVersion ?? undefined,
        // AC-3b (iterate-2026-05-05) — enable the writer-stuck watchdog
        // in production. Capability auto-detected against the live WS;
        // logs warn + degrades to ws.close-driven release if missing.
        watchdogEnabled: true,
      });
      if (headlessMirrorEnabledEffective && snapshotStoreReady) {
        console.log(
          JSON.stringify({
            level: "info",
            message:
              "headless-mirror enabled (ADR-088/087); cell-state snapshots are the sole replay primitive",
            dir: config.terminalScrollbackDir,
          }),
        );
      }

      // Boot-time TTL sweep — bounded, oldest-first, active-aware.
      // AC-11 active definition: task in sdk-sessions.json with state ∈
      // {active, idle, awaiting_external_start, jsonl_missing} OR live
      // pty entry in pty-manager (catches stale-session-but-live-pty
      // edge case — Phase-3 review fix HIGH).
      const computeActiveTaskIds = (): Set<string> => {
        const all = sdkSessionsStore.list();
        const ids = new Set<string>();
        for (const t of all) {
          if (
            t.state === "active" ||
            t.state === "idle" ||
            t.state === "awaiting_external_start" ||
            t.state === "jsonl_missing"
          ) {
            ids.add(t.taskId);
          }
        }
        for (const id of ptyManager.getLiveTaskIds()) {
          ids.add(id);
        }
        return ids;
      };
      try {
        const result = await scrollbackStore.sweepExpired(
          config.terminalScrollbackTtlDays,
          {
            activeTaskIds: computeActiveTaskIds(),
            maxFilesPerPass: config.terminalSweepMaxFilesPerPass,
          },
        );
        if (result.deleted > 0 || result.errors > 0) {
          console.log(
            JSON.stringify({
              level: "info",
              message: "scrollback boot sweep",
              deleted: result.deleted,
              remaining: result.remaining,
              errors: result.errors,
            }),
          );
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "scrollback boot sweep failed",
            error: String(err).slice(0, 200),
          }),
        );
      }
      // Daily periodic sweep. setInterval is unref'd so it doesn't keep the
      // event loop alive past graceful shutdown.
      const dailySweepTimer = setInterval(() => {
        scrollbackStore
          .sweepExpired(config.terminalScrollbackTtlDays, {
            activeTaskIds: computeActiveTaskIds(),
            maxFilesPerPass: config.terminalSweepMaxFilesPerPass,
          })
          .catch((err: unknown) => {
            console.warn(
              JSON.stringify({
                level: "warn",
                message: "scrollback periodic sweep failed",
                error: String(err).slice(0, 200),
              }),
            );
          });
      }, 24 * 60 * 60 * 1000);
      dailySweepTimer.unref();

      // @hono/node-ws adapter — `upgradeWebSocket` is a Hono middleware
      // factory, `injectWebSocket(server)` patches the underlying
      // http.Server (returned by `serve(...)`) to handle WS upgrades.
      const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

      app.route(
        "/",
        createExternalRoutes({
          store: sdkSessionsStore,
          watcher: sessionWatcher,
          // Section 02 — PATCH/POST projectId validation. Excludes the
          // synthesized Unassigned row (that sentinel is hard-coded valid
          // inside validateProjectIdOrError).
          getKnownProjectIds: () =>
            new Set(projectManager.getAll().filter((p) => !p.synthesized).map((p) => p.id)),
          // Section 03 — actions / preview / stub routes. Synthesized row
          // has no filesystem path so it's skipped by getProjectById.
          getProjectById: (id) => {
            const p = projectManager.getById(id);
            if (!p || p.synthesized) return undefined;
            return {
              id: p.id,
              name: p.name,
              path: p.path,
              profile: p.profile,
              synthesized: p.synthesized,
              settings: p.settings ? { color: p.settings.color } : undefined,
            };
          },
          previewManager,
          loadProfile: (name: string) => loadProfileReal(name, getProfilesDir()),
          // ADR-068-A1: cascade-clean scrollback on DELETE /tasks/:id.
          scrollbackClearBestEffort: (taskId: string) =>
            scrollbackStore.clearBestEffort(taskId),
          // Iterate C (ADR-087, MEDIUM-B1 fix): cascade-clean cell-state
          // snapshot on DELETE /tasks/:id. Snapshots may contain secrets;
          // the 24-h TTL is a backstop, the task delete is the
          // authoritative privacy boundary.
          snapshotClearBestEffort: (taskId: string) =>
            snapshotStore.clearBestEffort(taskId),
          // iterate-2026-05-08 v0.8.7 AC-1: live-pty lookup so transcript
          // poll can flip new-plain `active → idle` after pty-kill.
          // iterate-2026-05-18-inbox-terminal-prompts: peekTerminalText so
          // the inbox can detect a waiting AskUserQuestion picker from the
          // live @xterm/headless mirror.
          ptyManager: {
            get: (taskId: string) => ptyManager.get(taskId),
            peekTerminalText: (taskId: string) =>
              ptyManager.peekTerminalText(taskId),
          },
        }),
      );
      app.route("/", createDiagnosticsRoutes({ store: sdkSessionsStore, versionInfo }));

      // FR-01.30 / ADR-101 — Triage Tab routes. Mounts after /api/external
      // so it inherits the same CORS/Origin gate. The promote route uses
      // the same `proper-lockfile` pattern as sdk-sessions.json.
      app.route(
        "/",
        createTriageRoutes({
          store: sdkSessionsStore,
          getAllProjects: () =>
            projectManager
              .getAll()
              .filter((p) => !p.synthesized)
              .map((p) => ({ id: p.id, path: p.path, synthesized: p.synthesized })),
          getProjectById: (id) => {
            const p = projectManager.getById(id);
            if (!p || p.synthesized) return undefined;
            return { id: p.id, path: p.path, synthesized: p.synthesized };
          },
          // ADR-106: collision-safe `.weblock` lock path so the webui
          // never clashes with the Python `_FileLock` regular-file
          // sidecar at `triage.jsonl.lock` (RC1). The route no longer
          // takes a separate sdk-sessions lock (RC2 — store.persist()
          // locks itself), so `sessionsLockPath` is gone.
          lock: createTriageLock(),
          // FR-01.33 — injected campaign-ref reader so the triage route can
          // annotate items with the campaign that expands them WITHOUT
          // importing any campaign module (preserves the
          // campaigns-no-triage-coupling import boundary; the composition
          // root owns the join). Best-effort: any read failure → [].
          listCampaignRefs: (projectId) => {
            const p = projectManager.getById(projectId);
            if (!p || p.synthesized) return [];
            const pr = resolveCampaignsDir({
              path: p.path,
              synthesized: p.synthesized,
            });
            if (!pr.ok) return [];
            try {
              return readCampaigns(pr.absolute, pr.projectRoot).map((cmp) => ({
                expandsTriage: cmp.expandsTriage,
                slug: cmp.slug,
                status: cmp.status,
              }));
            } catch {
              return [];
            }
          },
        }),
      );

      // FR-01.31 — Campaigns lane routes. GET is a read-only sibling of the
      // triage route; mounts after /api/external so it inherits the same
      // CORS/Origin gate. FR-01.33 adds POST /:slug/start — the ONE WebUI write
      // to campaign state (draft → active), lock-protected via the same
      // collision-safe `.weblock` `createTriageLock()` pattern. All other
      // campaign-state writes still belong to campaign_init.py /
      // campaign_progress.py.
      app.route(
        "/",
        createCampaignsRoutes({
          getProjectById: (id) => {
            const p = projectManager.getById(id);
            if (!p || p.synthesized) return undefined;
            return { id: p.id, path: p.path, synthesized: p.synthesized };
          },
          lock: createTriageLock(),
        }),
      );

      // Iterate 4 (ADR-067) + Iterate 5 (ADR-068-A1) — embedded terminal
      // routes (REST + WS upgrade). scrollbackStore wires replay-on-attach
      // + Stop/Clear semantics + disabled-mode propagation.
      //
      // ADR-084 (iterate v0.9.1) — pass the boot-time-resolved
      // `corsOriginPolicy.isAllowed` as `allowedOrigins` so the WS
      // upgrade gate uses the SAME policy as the HTTP CORS middleware.
      // Without this wiring the gate falls back to `defaultAllowedOrigins`
      // → `resolveTrustedOrigins(process.env)` WITHOUT exec → loopback
      // only — which silently rejects every non-loopback Origin even
      // when SHIPWRIGHT_NETWORK_PROFILE=tailscale was meant to widen the
      // policy. Empirically reproduced via curl WS-upgrade probe with
      // MagicDNS Origin (500 Internal Server Error) before this line
      // was added; 101 Switching Protocols after.
      // ADR-089 (Iterate B) — resolve the currently-pinned
      // @xterm/headless version once at boot so the WS replay path can
      // version-gate snapshot envelopes. The Iterate-C boot probe
      // (`headlessProbe.terminalVersion`) is the primary source; we
      // keep fs-fallback as a defensive secondary path in case the
      // dynamic import worked but the package.json read returned null.
      let expectedTerminalVersion: string | undefined =
        headlessProbe.terminalVersion ?? undefined;
      if (!expectedTerminalVersion) {
        try {
          const { readFileSync } = await import("node:fs");
          const { fileURLToPath } = await import("node:url");
          const pathMod = await import("node:path");
          const here = pathMod.dirname(fileURLToPath(import.meta.url));
          for (const cand of [
            pathMod.resolve(here, "../node_modules/@xterm/headless/package.json"),
            pathMod.resolve(here, "../../node_modules/@xterm/headless/package.json"),
          ]) {
            try {
              const json = JSON.parse(readFileSync(cand, "utf8")) as {
                version?: string;
              };
              if (json.version) {
                expectedTerminalVersion = json.version;
                break;
              }
            } catch {
              /* try next */
            }
          }
        } catch {
          /* fall through with undefined */
        }
      }
      createTerminalRoutes({
        store: sdkSessionsStore,
        ptyManager,
        upgradeWebSocket,
        pastesKeepLast: config.claudePastesKeepLast,
        scrollbackStore,
        // ADR-089 — wire the snapshot store + expected version so the WS
        // replay branch uses the new envelope when a snapshot exists.
        // The snapshot store is created above (ADR-088); we only pass it
        // through here when the flag is effectively ON (config + probe).
        snapshotStore:
          headlessMirrorEnabledEffective && snapshotStoreReady
            ? snapshotStore
            : undefined,
        expectedTerminalVersion,
        // Iterate v0.8.2 AC-9 — retention + dir surfaced in `ready`.
        retentionDays: config.terminalScrollbackTtlDays,
        scrollbackDirHint: config.terminalScrollbackDir,
        allowedOrigins: corsOriginPolicy.isAllowed,
      })(app);

      // Section 03 — boot-time profile coherence check (plan § 2.1 matrix).
      // Warn (don't fail) when stack.frontend is declared but dev_server
      // is not wired, or vice versa. Non-fatal — the API route resolves
      // preview.enabled per request, but the log helps operators diagnose
      // "why isn't Preview showing up?" without opening devtools.
      try {
        const all = projectManager.getAll().filter((p) => !p.synthesized);
        for (const proj of all) {
          if (!proj.profile) continue;
          const prof = loadProfileReal(proj.profile, getProfilesDir()) as
            | (ReturnType<typeof loadProfileReal> & { stack?: { frontend?: unknown } })
            | null;
          if (!prof) continue;
          const hasFrontend = Boolean(
            (prof as { stack?: { frontend?: unknown } }).stack?.frontend,
          );
          const hasDevServer = Boolean(prof.dev_server?.command);
          if (hasFrontend && !hasDevServer) {
            console.warn(
              JSON.stringify({
                level: "warn",
                message:
                  "profile declares stack.frontend but no dev_server.command — preview button will stay hidden",
                projectId: proj.id,
                profile: proj.profile,
              }),
            );
          }
          if (!hasFrontend && hasDevServer) {
            console.warn(
              JSON.stringify({
                level: "warn",
                message:
                  "profile has dev_server.command but no stack.frontend — preview gate denies regardless (ADR-036)",
                projectId: proj.id,
                profile: proj.profile,
              }),
            );
          }
        }
      } catch (err) {
        // Non-fatal — the diagnostic is purely informational.
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "boot-time profile coherence check threw",
            error: String(err).slice(0, 200),
          }),
        );
      }

      // Phase-3 review fix (HIGH): shutdown is now async + awaits the
      // scrollback drain BEFORE process.exit. The hard 3s timer remains
      // as a safety fallback only.
      const shutdown = async () => {
        console.log("Shutting down…");
        try {
          previewManager.killAll();
        } catch {
          // best-effort — ignore shutdown errors
        }
        try {
          ptyManager.killAll();
        } catch {
          // best-effort — ignore shutdown errors
        }
        // Hard ceiling fires only if scrollbackStore.shutdown hangs.
        const hardCap = setTimeout(() => process.exit(0), 3000);
        hardCap.unref();
        try {
          await scrollbackStore.shutdown(2000);
        } catch (err) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "scrollback shutdown threw",
              error: String(err).slice(0, 200),
            }),
          );
        }
        clearTimeout(hardCap);
        process.exit(0);
      };
      process.on("SIGTERM", () => void shutdown());
      process.on("SIGINT", () => void shutdown());
      process.on("exit", () => {
        try {
          previewManager.killAll();
        } catch {
          // ignore
        }
        try {
          ptyManager.killAll();
        } catch {
          // ignore
        }
      });

      // `@hono/node-server`'s `serve` returns the underlying Node
      // `http.Server`. Attach an `error` listener so bind failures
      // (EADDRINUSE from a parallel worktree, EACCES on a privileged
      // port, etc.) produce a deterministic operator-facing line and
      // a non-zero exit instead of a silent half-startup. No probe
      // before bind — that would be TOCTOU-racy on Windows.
      // Default = 127.0.0.1 (loopback). HONO_HOST=true binds dual-stack
      // (`::`); HONO_HOST=<addr> binds that interface. See resolveHonoHost.ts
      // and docs/guide.md §9.1 for the full contract.
      const honoHost = resolveHonoHost(process.env);
      // ADR-08X exposure warning. Two paths (mirrors vite.config.ts):
      //   1. SHIPWRIGHT_NETWORK_PROFILE=open — emits exact AC-3 wording.
      //   2. Explicit HONO_HOST=true/0.0.0.0/:: with profile NOT set —
      //      legacy-escape-hatch warning (OpenAI iterate review #9).
      const explicitProfileOpen =
        process.env.SHIPWRIGHT_NETWORK_PROFILE?.trim() === "open";
      const explicitWildcardBind =
        honoHost === "0.0.0.0" || honoHost === "::" || honoHost === "true";
      if (explicitProfileOpen) {
        console.warn(
          "[network-profile] WARNING: profile=open — server is exposed on " +
            "every interface; use only on trusted networks",
        );
      } else if (explicitWildcardBind) {
        console.warn(
          `[network-profile] WARNING: Hono server is binding to all ` +
            `interfaces (${honoHost}) via explicit HONO_HOST — exposed to ` +
            `every reachable network. Use only on trusted networks ` +
            `(home/office). Consider switching to ` +
            `SHIPWRIGHT_NETWORK_PROFILE=tailscale in .env.local when on ` +
            `untrusted Wi-Fi.`,
        );
      }
      const server = serve(
        { fetch: app.fetch, port: config.port, hostname: honoHost },
        (info) => {
          const reachableLabel =
            honoHost === "127.0.0.1" || honoHost === "::1"
              ? "localhost"
              : info.address || honoHost;
          console.log(
            `Shipwright Command Center listening on http://${reachableLabel}:${info.port} (bind=${honoHost})`,
          );
          // Iterate v0.8.4 — surface the trusted-origin policy so a
          // mute terminal over Tailscale immediately shows whether the
          // gate is loopback-only (the bug we just fixed) or widened.
          console.log(
            `Trusted-Origin policy: ${corsOriginPolicy.describe()}`,
          );
        },
      );
      server.on("error", (err: unknown) => {
        const { message, exitCode } = formatBindError(err, config.port);
        console.error(`FATAL: ${message}`);
        process.exit(exitCode);
      });

      // Iterate 4 (ADR-067) — attach @hono/node-ws to the underlying
      // http.Server so the /api/terminal/:taskId/ws upgrade fires.
      // Must be called AFTER serve(...) since it patches that server.
      injectWebSocket(server);
    } catch (err) {
      console.error("FATAL: Server startup failed:", err);
      process.exit(1);
    }
  })();
}

app.use("/*", serveStatic({ root: config.staticDir }));

// SPA fallback (iterate-2026-05-22-spa-fallback).
// Any GET that did not match a real handler or a static asset under
// `client/dist/` is served the SPA shell (`client/dist/index.html`) so
// react-router-dom can hydrate the requested route client-side. This
// fixes hard-reload of /triage, /inbox, /tasks/:id, /projects,
// /diagnostics, /settings — which previously hit `app.notFound` and
// returned `{"error":"Not found"}`.
//
// /api/* keeps its JSON-404 contract: the fallback `next()`s through
// to `app.notFound` so any unknown REST route still surfaces as a
// real 404 instead of an HTML body the client would fail to parse.
app.get("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) {
    return next();
  }
  try {
    const html = await readFile(`${config.staticDir}/index.html`, "utf-8");
    return c.html(html);
  } catch {
    return next();
  }
});

app.notFound((c) => c.json({ error: "Not found" }, 404));
