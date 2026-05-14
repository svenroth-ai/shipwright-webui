/**
 * Iterate K (ADR-099) — empirical A/B visual probe for smearing.
 *
 * The companion to `probe-iterate-k-scenarios.mjs`. While that probe
 * validates the CONTROL FLOW (maintenance fires when expected, idle
 * gate holds, alt-screen invariant holds), this probe validates the
 * VISUAL OUTCOME — does the rendered canvas actually look different
 * with the workaround OFF vs ON?
 *
 * Mechanism:
 *   1. `?atlasMaintenance=off` is a probe-only query-param kill switch
 *      added to `EmbeddedTerminal.tsx` (Iterate K UAT instrumentation).
 *      It short-circuits the entire `if (webglRef)` block: no atlas
 *      clears, no refreshes, no wheel/scroll/onWriteParsed listeners.
 *   2. We pick a replay-only task (`task-tool-tips-done`, state=done)
 *      so the WS sends one snapshot and CLOSES — after that, the live
 *      pty is silent and our synthetic stream has the terminal to
 *      itself, uninterrupted.
 *   3. We write a deterministic Claude-TUI-shaped stress stream via
 *      `term.write()` (per ADR-099 § Context: 256-color foreground
 *      glyphs separated by cursor-rights at per-cell granularity is
 *      exactly the emit shape that triggers xterm.js#5847).
 *   4. We pause at timeline milestones (5s / 15s / 30s / 45s / 60s,
 *      plus a post-wheel capture) and screenshot the canvas region.
 *   5. We compute SHA-256 of each PNG so the user (or a future test)
 *      can mechanically verify "OFF and ON produced different
 *      pixels" without a per-pixel diff library.
 *
 * Output: `client/playwright-report/iterate-k-smearing-ab/<task>/...`
 *   - `off/t5.png`, `off/t15.png`, … — workaround disabled
 *   - `on/t5.png`,  `on/t15.png`,  … — workaround enabled
 *   - `compare.json` — SHA-256 hashes + file sizes per matched pair
 *
 * Run from `client/`:
 *   BASE_URL=http://webui-host.tailnet.ts.net:5173 \
 *     node e2e/probe-iterate-k-smearing-ab.mjs
 */
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.BASE_URL ?? "http://webui-host.tailnet.ts.net:5173";
const REPORT_DIR = path.resolve(__dirname, "../playwright-report/iterate-k-smearing-ab");

// task-tool-tips-done is the replay-only target: WS sends one snapshot
// envelope then closes; no live pty interrupts our synthetic stream.
const DEFAULT_TASKS = [
  { id: "58be94c5-e108-43de-b6e0-aa6326cb9ea1", label: "tool-tips-done" },
];

const TASKS = process.env.PROBE_TASKS
  ? process.env.PROBE_TASKS.split(",").map((id, i) => ({ id: id.trim(), label: `task-${i + 1}` }))
  : DEFAULT_TASKS;

// Capture timeline (seconds from stress-start).
const CAPTURE_TIMELINE = [5, 15, 30, 45, 60];
const STRESS_DURATION_S = 60;

await fs.mkdir(REPORT_DIR, { recursive: true });

console.log(`Probe target: ${BASE_URL}`);
console.log(`Tasks: ${TASKS.map((t) => `${t.id} (${t.label})`).join(", ")}`);

/**
 * Deterministic synthetic stream matching Claude TUI's
 * atlas-corruption-triggering emit shape:
 *   - 256-color foreground escapes (`\x1b[38;5;Nm`)
 *   - full-block glyph (`█`, U+2588) — wide-glyph cell-fill pressure
 *   - cursor-right insertions (`\x1b[1C`) — per-word pacing emulation
 *   - SGR reset between lines so colors don't bleed across rows
 *
 * Build once per trial; chunked at the call site for 50 ms-spaced
 * batches. Returns ~10 KiB per batch (`lines * cellsPerLine` glyphs
 * + escape sequences).
 */
function buildStressBatch({ lines, cellsPerLine, batchIndex }) {
  const colors = [196, 202, 208, 214, 220, 226, 190, 154, 118, 82, 46, 39, 33, 27, 21, 57, 93, 129];
  let out = "";
  let colorCounter = batchIndex * 7919; // prime so consecutive batches don't repeat the same palette walk
  for (let line = 0; line < lines; line++) {
    for (let cell = 0; cell < cellsPerLine; cell++) {
      const c = colors[(colorCounter++ * 13 + cell) % colors.length];
      out += "\x1b[38;5;" + c + "m█";
      // Cursor-right every 4 cells matches Claude's per-word emit shape.
      if (cell % 4 === 3) out += "\x1b[1C";
    }
    out += "\x1b[0m\r\n";
  }
  return out;
}

/**
 * Spy / instrumentation init-script. Pre-installs accessors on the
 * `__embeddedTerminal*` window properties so we can count maintenance
 * fires in real time as the stress runs.
 */
function spyInitScript() {
  return `
    (() => {
      window.__atlasLog = [];
      window.__atlasLogMounts = 0;
      const push = (entry) => window.__atlasLog.push(entry);
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

/**
 * Drive one A/B trial for a single task + variant.
 * Returns matched-pair manifest entries for compare.json.
 */
async function runTrial({ context, taskMeta, variant, trialDir }) {
  console.log(`\n--- ${taskMeta.label} :: variant=${variant} ---`);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error(`  [pageerror] ${err.message}`));
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error") console.log(`  [console.error] ${msg.text().slice(0, 200)}`);
  });

  const url = `${BASE_URL}/tasks/${taskMeta.id}?atlasMaintenance=${variant}`;
  console.log(`  navigate ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
  await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 25_000 });
  // Give the WS replay-snapshot time to land + clear so our stream
  // doesn't interleave with the snapshot write.
  await page.waitForTimeout(4_000);

  // Verify the kill-switch state landed as expected. ON = workaround
  // active (atlasLogMounts ≥ 1, refresh-patch installed). OFF = no
  // listeners but spies still installed via addInitScript so we can
  // confirm zero maintenance fires.
  const preMeta = await page.evaluate(() => {
    const term = window.__embeddedTerminal;
    return {
      installed: Boolean(term),
      mounts: window.__atlasLogMounts ?? 0,
      bufferType: term?.buffer?.active?.type ?? "unknown",
      cols: term?.cols ?? null,
      rows: term?.rows ?? null,
    };
  });
  console.log(`  pre-stress meta: ${JSON.stringify(preMeta)}`);
  if (!preMeta.installed) {
    console.error("  ✗ embedded terminal not mounted — aborting trial");
    await page.close();
    return null;
  }

  // Reset the terminal + force main-buffer (smearing is worst in
  // main-buffer per ADR-099 § Decision § 2 — alt-screen does refresh-
  // only and the v5 split documented less perceptible smearing
  // there). `?47l` leaves the alt-screen and returns to main, then
  // `\x1b[2J\x1b[H` clears + homes cursor.
  await page.evaluate(() => {
    const term = window.__embeddedTerminal;
    if (!term) return;
    // Force main-buffer return + full clear.
    term.write("\x1b[?47l\x1b[?1049l\x1b[2J\x1b[H");
  });
  await page.waitForTimeout(500);

  // Clear the atlas-log so trial events stand alone.
  await page.evaluate(() => { window.__atlasLog = []; });

  // Drive the stress stream over STRESS_DURATION_S seconds. Each
  // batch writes 3 lines × 80 cells = 240 colored glyphs ≈ 1200 cells
  // per second at 50 ms cadence. Captures interleave on the
  // CAPTURE_TIMELINE.
  const stressStartedAt = Date.now();
  const BATCH_INTERVAL_MS = 50;
  const LINES_PER_BATCH = 3;
  const CELLS_PER_LINE = 80;

  // Schedule the captures.
  const captures = [];
  for (const tSec of CAPTURE_TIMELINE) {
    captures.push({ t: tSec, due: stressStartedAt + tSec * 1000, taken: false });
  }
  let batchIndex = 0;
  let stressEnded = false;

  const stressLoop = async () => {
    while (!stressEnded && Date.now() - stressStartedAt < STRESS_DURATION_S * 1000) {
      const batch = buildStressBatch({
        lines: LINES_PER_BATCH,
        cellsPerLine: CELLS_PER_LINE,
        batchIndex: batchIndex++,
      });
      await page.evaluate((b) => {
        const term = window.__embeddedTerminal;
        if (term) term.write(b);
      }, batch);
      await page.waitForTimeout(BATCH_INTERVAL_MS);
    }
  };

  // Run stress loop + capture loop concurrently.
  const captureLoop = async () => {
    while (!stressEnded) {
      const now = Date.now();
      const next = captures.find((c) => !c.taken && now >= c.due);
      if (next) {
        const filename = `t${next.t}.png`;
        const filepath = path.join(trialDir, filename);
        await page
          .locator('[data-testid="embedded-terminal-canvas"]')
          .screenshot({ path: filepath });
        next.taken = true;
        console.log(`  captured ${variant}/${filename}`);
      }
      if (captures.every((c) => c.taken) && Date.now() - stressStartedAt >= STRESS_DURATION_S * 1000) {
        break;
      }
      await page.waitForTimeout(150);
    }
  };

  await Promise.all([stressLoop(), captureLoop()]);
  stressEnded = true;

  // Post-wheel capture: hover canvas + dispatch a wheel event. With
  // workaround=on, v8 wheel listener fires safeAtlasMaintenance() and
  // (in main-buffer) clears the atlas. With workaround=off, nothing
  // happens. Visible difference here is the most direct evidence of
  // v8's contribution.
  await page
    .locator('[data-testid="embedded-terminal-canvas"]')
    .hover({ timeout: 5_000 });
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(400);
  const wheelFile = path.join(trialDir, "t-post-wheel.png");
  await page.locator('[data-testid="embedded-terminal-canvas"]').screenshot({ path: wheelFile });
  console.log(`  captured ${variant}/t-post-wheel.png`);

  // Final per-event log + summary for the trial.
  const log = await page.evaluate(() => [...(window.__atlasLog ?? [])]);
  const byKind = {};
  for (const e of log) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  console.log(`  atlas-log: ${log.length} events ${JSON.stringify(byKind)}`);

  await fs.writeFile(
    path.join(trialDir, "atlas-log.json"),
    JSON.stringify({ preMeta, log, byKind }, null, 2),
    "utf8",
  );

  await page.close();

  return { variant, log, byKind, preMeta };
}

async function sha256(filepath) {
  const buf = await fs.readFile(filepath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

async function fileSize(filepath) {
  try {
    return (await fs.stat(filepath)).size;
  } catch {
    return null;
  }
}

const browser = await chromium.launch({
  headless: false,
  devtools: false,
  slowMo: 0,
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript(spyInitScript());

const MASTER_RESULTS = [];

for (const taskMeta of TASKS) {
  const taskDir = path.join(REPORT_DIR, taskMeta.label);
  const offDir = path.join(taskDir, "off");
  const onDir = path.join(taskDir, "on");
  await fs.mkdir(offDir, { recursive: true });
  await fs.mkdir(onDir, { recursive: true });

  console.log(`\n========================================`);
  console.log(`Task: ${taskMeta.id} (${taskMeta.label})`);
  console.log(`========================================`);

  const offResult = await runTrial({ context, taskMeta, variant: "off", trialDir: offDir });
  const onResult = await runTrial({ context, taskMeta, variant: "on", trialDir: onDir });

  // Build the matched-pair compare manifest.
  const pairs = [];
  for (const tSec of CAPTURE_TIMELINE) {
    const off = path.join(offDir, `t${tSec}.png`);
    const on = path.join(onDir, `t${tSec}.png`);
    const offHash = await sha256(off);
    const onHash = await sha256(on);
    const offSize = await fileSize(off);
    const onSize = await fileSize(on);
    pairs.push({
      label: `t${tSec}`,
      offHash,
      onHash,
      offSize,
      onSize,
      identical: offHash === onHash,
      sizeDeltaBytes: offSize != null && onSize != null ? onSize - offSize : null,
    });
  }
  // Post-wheel pair.
  {
    const off = path.join(offDir, "t-post-wheel.png");
    const on = path.join(onDir, "t-post-wheel.png");
    const offHash = await sha256(off);
    const onHash = await sha256(on);
    const offSize = await fileSize(off);
    const onSize = await fileSize(on);
    pairs.push({
      label: "t-post-wheel",
      offHash,
      onHash,
      offSize,
      onSize,
      identical: offHash === onHash,
      sizeDeltaBytes: offSize != null && onSize != null ? onSize - offSize : null,
    });
  }

  const taskResult = {
    task: taskMeta.label,
    taskId: taskMeta.id,
    pairs,
    off: { atlasLogByKind: offResult?.byKind ?? {} },
    on: { atlasLogByKind: onResult?.byKind ?? {} },
  };
  MASTER_RESULTS.push(taskResult);
  await fs.writeFile(
    path.join(taskDir, "compare.json"),
    JSON.stringify(taskResult, null, 2),
    "utf8",
  );

  console.log(`\nCompare manifest for ${taskMeta.label}:`);
  for (const p of pairs) {
    const tag = p.identical ? "IDENTICAL" : "DIFFER";
    console.log(`  ${p.label.padEnd(15)} ${tag.padEnd(10)} off=${p.offHash} on=${p.onHash}  sizeΔ=${p.sizeDeltaBytes}`);
  }
}

await fs.writeFile(
  path.join(REPORT_DIR, "results.json"),
  JSON.stringify({ baseUrl: BASE_URL, ranAt: new Date().toISOString(), tasks: MASTER_RESULTS }, null, 2),
  "utf8",
);

console.log(`\n=== PROBE COMPLETE ===`);
console.log(`Report dir: ${REPORT_DIR}`);
console.log(`Matched pairs above; open the PNGs to visually verify smearing OFF vs ON.`);

await new Promise((r) => setTimeout(r, 2000));
await browser.close();
