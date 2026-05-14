/**
 * Iterate K v8 (ADR-099) — systematic Playwright headed probe for the 10
 * atlas-maintenance scenarios from
 * `.shipwright/planning/iterate/handoff-v8-systematic-testing.md`.
 *
 * The probe attaches spies on `WebglAddon.prototype.clearTextureAtlas`
 * and `Terminal.prototype.refresh` AFTER mount (using the
 * `window.__embeddedTerminal` + `window.__embeddedTerminalWebglAddon`
 * test handles), then drives each scenario and writes a JSON event log
 * + screenshots to `client/playwright-report/iterate-k-v8/<scenario>/`.
 *
 * The probe targets EXISTING live tasks (passed via env or argv) so we
 * can observe real Claude streaming under real conditions. Defaults to
 * the three tasks the user identified at handoff:
 *   - 4a9fe7f2  main-buffer
 *   - 58be94c5  alt-screen
 *   - 810efeca  main-buffer + recent
 *
 * Run from `client/`:
 *   BASE_URL=http://pc-dinovo-002.tail4353f0.ts.net:5173 \
 *     node e2e/probe-iterate-k-scenarios.mjs
 *
 * Override the task list:
 *   PROBE_TASKS=<id1>,<id2>,<id3> node e2e/probe-iterate-k-scenarios.mjs
 *
 * Skip individual scenarios:
 *   PROBE_SKIP=S3,S5 node e2e/probe-iterate-k-scenarios.mjs
 */
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.BASE_URL ?? "http://pc-dinovo-002.tail4353f0.ts.net:5173";
const REPORT_DIR = path.resolve(__dirname, "../playwright-report/iterate-k-v8");
const DEFAULT_TASKS = [
  { id: "4a9fe7f2-05c7-451a-a311-57bbd85abecb", label: "task-claude-goal" },
  { id: "58be94c5-e108-43de-b6e0-aa6326cb9ea1", label: "task-tool-tips-done" },
  { id: "810efeca-aa58-44e6-b57b-4045b5af8659", label: "task-claude-design" },
];

const TASKS = process.env.PROBE_TASKS
  ? process.env.PROBE_TASKS.split(",").map((id, i) => ({
      id: id.trim(),
      label: `task-${i + 1}`,
    }))
  : DEFAULT_TASKS;

const SKIP = new Set((process.env.PROBE_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean));

console.log(`Probe target: ${BASE_URL}`);
console.log(`Tasks: ${TASKS.map((t) => `${t.id} (${t.label})`).join(", ")}`);
if (SKIP.size > 0) console.log(`Skipping scenarios: ${Array.from(SKIP).join(", ")}`);

await fs.mkdir(REPORT_DIR, { recursive: true });

/**
 * Pre-installed spy hooks. Run via `page.addInitScript` BEFORE any page
 * script (including the React bundle) so the property-setter on
 * `window.__embeddedTerminal` / `__embeddedTerminalWebglAddon` fires the
 * moment EmbeddedTerminal's mount-effect assigns them — BEFORE any
 * snapshot-replay or burst-after-quiet maintenance pass.
 *
 * Why the accessor pattern: a post-mount `page.evaluate` call would land
 * after the WS opens and the replay-snapshot write fires, which itself
 * triggers `term.onWriteParsed` and runs the first maintenance pass.
 * Patching the prototypes after that point would miss the most
 * interesting event in S1 (post-mount initial maintenance).
 */
function spyInitScript() {
  return `
    (() => {
      // Per-scenario log (cleared by the probe between scenarios).
      window.__atlasLog = [];
      // Cross-scenario mirror used by S7's invariant check — never cleared.
      window.__atlasLogAll = [];
      window.__atlasLogMounts = 0;

      const push = (entry) => {
        window.__atlasLog.push(entry);
        window.__atlasLogAll.push(entry);
      };

      const patchWebgl = (webgl) => {
        if (!webgl || webgl.__atlasLogPatched) return;
        webgl.__atlasLogPatched = true;
        if (typeof webgl.clearTextureAtlas !== "function") return;
        const orig = webgl.clearTextureAtlas.bind(webgl);
        webgl.clearTextureAtlas = function () {
          const bt = window.__embeddedTerminal?.buffer?.active?.type ?? "unknown";
          push({ ts: Date.now(), kind: "clearTextureAtlas", bufferType: bt });
          return orig();
        };
      };

      const patchTerm = (term) => {
        if (!term || term.__atlasLogPatched) return;
        term.__atlasLogPatched = true;
        const origRefresh = term.refresh.bind(term);
        term.refresh = function (start, end) {
          const bt = term.buffer?.active?.type ?? "unknown";
          push({ ts: Date.now(), kind: "refresh", start, end, bufferType: bt });
          return origRefresh(start, end);
        };
      };

      let termRef = null;
      let webglRef = null;
      Object.defineProperty(window, "__embeddedTerminal", {
        configurable: true,
        get() { return termRef; },
        set(v) {
          termRef = v;
          if (v) {
            window.__atlasLogMounts++;
            patchTerm(v);
          }
        },
      });
      Object.defineProperty(window, "__embeddedTerminalWebglAddon", {
        configurable: true,
        get() { return webglRef; },
        set(v) {
          webglRef = v;
          if (v) patchWebgl(v);
        },
      });
    })();
  `;
}

async function readSpyMeta(page) {
  return await page.evaluate(() => {
    const term = window.__embeddedTerminal;
    const webgl = window.__embeddedTerminalWebglAddon;
    return {
      installed: Boolean(term),
      mounts: window.__atlasLogMounts ?? 0,
      webglPresent: Boolean(webgl),
      initialBufferType: term?.buffer?.active?.type ?? "unknown",
      xtermCols: term?.cols ?? null,
      xtermRows: term?.rows ?? null,
    };
  });
}

async function readLog(page) {
  return await page.evaluate(() => {
    const w = window;
    return w.__atlasLog ? [...w.__atlasLog] : [];
  });
}

async function clearLog(page) {
  await page.evaluate(() => {
    const w = window;
    w.__atlasLog = [];
  });
}

async function readBufferType(page) {
  return await page.evaluate(() => {
    const w = window;
    return w.__embeddedTerminal?.buffer?.active?.type ?? null;
  });
}

/**
 * Wait for mount + WS ready, then read spy meta. Spies were pre-installed
 * via `context.addInitScript(spyInitScript())` so any maintenance pass
 * triggered by the mount-effect's snapshot-replay write was already
 * captured by the time this function returns.
 */
async function bootstrap(page, taskUrl) {
  await page.goto(taskUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 20_000 });
  // Best-effort wait for WS ready — some live tasks are replay-only.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="embedded-terminal"]');
        return el && (el.getAttribute("data-ws-ready") === "true" || el.getAttribute("data-ws-open") === "true");
      },
      null,
      { timeout: 15_000 },
    )
    .catch(() => {
      console.log("  ⚠ WS-ready selector never satisfied — proceeding anyway");
    });
  // Give the post-mount-settle timer (3s) a chance to fire before we
  // read the spy meta + clear the log for the first scenario.
  await page.waitForTimeout(500);
  return await readSpyMeta(page);
}

const RESULTS = [];

function summarise(log) {
  const byKind = {};
  for (const e of log) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  const byBuffer = {};
  for (const e of log) byBuffer[e.bufferType] = (byBuffer[e.bufferType] ?? 0) + 1;
  return { count: log.length, byKind, byBuffer };
}

async function runScenario(name, taskMeta, body) {
  if (SKIP.has(name)) {
    console.log(`\n[${name}] SKIPPED (PROBE_SKIP)`);
    RESULTS.push({ scenario: name, task: taskMeta.label, status: "skipped" });
    return;
  }
  console.log(`\n[${name}] task=${taskMeta.id} (${taskMeta.label}, ${taskMeta.bufferKind})`);
  const start = Date.now();
  try {
    const result = await body();
    const dur = Date.now() - start;
    console.log(`  duration=${dur}ms`);
    RESULTS.push({
      scenario: name,
      task: taskMeta.label,
      taskId: taskMeta.id,
      status: "ok",
      durationMs: dur,
      ...result,
    });
  } catch (err) {
    const dur = Date.now() - start;
    console.error(`  ✗ FAILED after ${dur}ms: ${err.message}`);
    RESULTS.push({
      scenario: name,
      task: taskMeta.label,
      taskId: taskMeta.id,
      status: "error",
      durationMs: dur,
      error: err.message,
    });
  }
}

const browser = await chromium.launch({
  headless: false,
  devtools: false,
  slowMo: 0,
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
// Install spy hooks BEFORE any page script. Property setters on
// `__embeddedTerminal` / `__embeddedTerminalWebglAddon` fire the moment
// EmbeddedTerminal's mount-effect assigns them — early enough to catch
// the very first maintenance pass triggered by the snapshot-replay
// write (which lands ~100ms after WS open, well before any
// post-navigation `page.evaluate` call would run).
await context.addInitScript(spyInitScript());
const page = await context.newPage();

// Wire console + websocket diagnostics throughout.
page.on("console", (msg) => {
  const t = msg.type();
  if (t === "error" || t === "warning") {
    console.log(`  [console.${t}] ${msg.text().slice(0, 200)}`);
  }
});
page.on("pageerror", (err) => console.error(`  [pageerror] ${err.message}`));

for (const taskMeta of TASKS) {
  const taskUrl = `${BASE_URL}/tasks/${taskMeta.id}`;
  const taskReportDir = path.join(REPORT_DIR, taskMeta.label);
  await fs.mkdir(taskReportDir, { recursive: true });

  console.log(`\n========================================`);
  console.log(`Task: ${taskMeta.id} (${taskMeta.label})`);
  console.log(`URL:  ${taskUrl}`);
  console.log(`========================================`);

  let spyMeta;
  try {
    spyMeta = await bootstrap(page, taskUrl);
    console.log(`  spy install: ${JSON.stringify(spyMeta)}`);
  } catch (err) {
    console.error(`  ✗ bootstrap failed: ${err.message} — skipping task`);
    RESULTS.push({ task: taskMeta.label, taskId: taskMeta.id, status: "bootstrap-error", error: err.message });
    continue;
  }

  // S1 — Fresh mount + initial settle. DO NOT clear the log: the
  // burst-after-quiet trigger fires the FIRST maintenance pass on the
  // snapshot-replay write that happens ~100ms after WS-open (well
  // before bootstrap() returns). The post-mount-settle backstop should
  // also fire at +3s from mount IF there have been additional writes
  // since the burst-fire reset `writesSinceLastClear` to 0.
  await runScenario("S1", taskMeta, async () => {
    // Capture whatever was already logged pre-bootstrap-return.
    const preBootstrapLog = await readLog(page);
    await page.waitForTimeout(4_000);
    const log = await readLog(page);
    await page.screenshot({ path: path.join(taskReportDir, "S1-post-mount.png") });
    return {
      log,
      summary: summarise(log),
      initialBufferType: spyMeta.initialBufferType,
      eventsCapturedPreBootstrap: preBootstrapLog.length,
    };
  });

  // S6 — Long idle (no writes). Count maintenances after 25s of no
  // input. Expect ~0 if the conditional gate is working correctly.
  await runScenario("S6", taskMeta, async () => {
    await clearLog(page);
    await page.waitForTimeout(25_000);
    const log = await readLog(page);
    return { log, summary: summarise(log) };
  });

  // S3 — Wheel scroll. Hover the canvas, dispatch wheel events, expect
  // a SINGLE debounced maintenance ~150ms after the last wheel.
  await runScenario("S3", taskMeta, async () => {
    await clearLog(page);
    await page
      .locator('[data-testid="embedded-terminal-canvas"]')
      .hover({ timeout: 5_000 });
    // 5 rapid wheel ticks within ~50ms — should coalesce into 1 maintenance.
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(10);
    }
    // Wait > 150ms debounce window + a small buffer.
    await page.waitForTimeout(400);
    const log = await readLog(page);
    return { log, summary: summarise(log), wheelTicksDispatched: 5 };
  });

  // S9 — Wheel during mouse-capture. On the alt-screen task Claude TUI
  // likely has ?1000h on; verify our DOM handler fires even when xterm
  // forwards the wheel to Claude as a mouse-report.
  await runScenario("S9", taskMeta, async () => {
    const bufType = await readBufferType(page);
    await clearLog(page);
    await page
      .locator('[data-testid="embedded-terminal-canvas"]')
      .hover({ timeout: 5_000 });
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(400);
    const log = await readLog(page);
    return {
      log,
      summary: summarise(log),
      bufferTypeAtScenario: bufType,
      expectation:
        bufType === "alternate"
          ? "refresh-only (no clearTextureAtlas in alt-screen)"
          : "clearTextureAtlas + refresh",
    };
  });

  // S5 — Visibility change. Simulate tab-hide and tab-show via
  // dispatchEvent + Object.defineProperty. (Real tab switch in headed
  // Chromium would pause rendering; the synthetic path is enough to
  // verify our code doesn't trip on the event.)
  await runScenario("S5", taskMeta, async () => {
    await clearLog(page);
    await page.evaluate(() => {
      try {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      } catch {
        /* noop */
      }
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      try {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      } catch {
        /* noop */
      }
    });
    await page.waitForTimeout(500);
    const log = await readLog(page);
    return { log, summary: summarise(log) };
  });

  // S8 / S2 / S4 — Active-streaming + burst-after-quiet. We can't drive
  // Claude streaming from the probe, so this is an OBSERVE-ONLY pass
  // over a 30s window during which the live task naturally streams (if
  // Claude is mid-tool-call) OR stays idle (if waiting on user). The
  // 10s periodic gate should fire ~3× if streaming, 0× if idle.
  await runScenario("S8", taskMeta, async () => {
    await clearLog(page);
    await page.waitForTimeout(30_000);
    const log = await readLog(page);
    await page.screenshot({ path: path.join(taskReportDir, "S8-after-30s.png") });
    return { log, summary: summarise(log) };
  });

  // S7 — Alt-screen mode invariant. Across ALL the above scenarios, in
  // alt-screen we must see clearTextureAtlas count == 0. Reads the
  // never-cleared `__atlasLogAll` mirror so the aggregate spans every
  // earlier scenario for this task.
  await runScenario("S7", taskMeta, async () => {
    const aggregate = await page.evaluate(() => {
      const w = window;
      const log = w.__atlasLogAll ?? [];
      const altClears = log.filter(
        (e) => e.kind === "clearTextureAtlas" && e.bufferType === "alternate",
      ).length;
      const mainClears = log.filter(
        (e) => e.kind === "clearTextureAtlas" && e.bufferType === "normal",
      ).length;
      const altRefresh = log.filter(
        (e) => e.kind === "refresh" && e.bufferType === "alternate",
      ).length;
      const mainRefresh = log.filter(
        (e) => e.kind === "refresh" && e.bufferType === "normal",
      ).length;
      return { altClears, mainClears, altRefresh, mainRefresh, total: log.length };
    });
    const invariantHeld = aggregate.altClears === 0;
    return { aggregate, invariantHeld };
  });

  // Final per-task screenshot.
  await page.screenshot({ path: path.join(taskReportDir, "final.png") });
  // Persist the full event log for this task (both views).
  const finalLog = await readLog(page);
  const finalLogAll = await page.evaluate(() => [...(window.__atlasLogAll ?? [])]);
  await fs.writeFile(
    path.join(taskReportDir, "atlas-log.json"),
    JSON.stringify({ lastScenario: finalLog, all: finalLogAll }, null, 2),
    "utf8",
  );
}

// S10 — placeholder. Future xterm 7.0 simulation.
RESULTS.push({
  scenario: "S10",
  status: "future",
  note: "xterm 7.0 sim — confirm workaround stays harmless when atlas-merge bug is upstream-fixed",
});

await fs.writeFile(
  path.join(REPORT_DIR, "results.json"),
  JSON.stringify({ baseUrl: BASE_URL, tasks: TASKS, results: RESULTS, ranAt: new Date().toISOString() }, null, 2),
  "utf8",
);

console.log(`\n=== PROBE COMPLETE ===`);
console.log(`Results: ${path.join(REPORT_DIR, "results.json")}`);
for (const r of RESULTS) {
  if (r.status === "ok") {
    console.log(`  ${r.scenario} (${r.task ?? "-"}): ${JSON.stringify(r.summary ?? r.aggregate ?? r)}`);
  } else {
    console.log(`  ${r.scenario ?? "-"} (${r.task ?? "-"}): ${r.status}${r.error ? " " + r.error : ""}`);
  }
}

await page.waitForTimeout(2_000);
await browser.close();
