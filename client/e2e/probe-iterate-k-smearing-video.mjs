/**
 * Iterate K (ADR-099) — empirical A/B VIDEO probe for smearing.
 *
 * Why: the stills-only A/B (`probe-iterate-k-smearing-ab.mjs`) showed
 * pixel-level differences between `?atlasMaintenance=off|on` (correctly
 * proving the kill switch + workaround actively affect WebGL output)
 * but could NOT capture smearing artifacts — smearing is a temporal
 * phenomenon that gets overwritten on next paint, so stills only catch
 * it if the capture lands within the corruption window AND the corrupt
 * frame survives long enough to be sampled.
 *
 * This probe records FULL VIDEO of the embedded terminal during a real
 * pty stream, with workaround OFF and ON. Two .webm files (~5 MiB
 * each) are saved + per-trial high-cadence frame stills are also
 * extracted so frame-by-frame inspection works without external video
 * tools.
 *
 * Stress stream: pwsh emits sustained 256-color glyphs separated by
 * cursor-rights (matching Claude TUI's #5847-triggering emit shape per
 * ADR-099 § Context) at ~10 lines / sec for ~30 s. Real pty, real WS,
 * real xterm WebGL renderer — no synthetic `term.write()` shortcut.
 *
 * Fresh task per probe run so the user's live sessions are not
 * disturbed. Task cleanup via DELETE at the end of each trial.
 *
 * Output: `client/playwright-report/iterate-k-smearing-video/<task>/
 *   off/video.webm + stills/t{...}.png + atlas-log.json
 *   on/video.webm  + stills/t{...}.png + atlas-log.json`
 *
 * Run from `client/`:
 *   BASE_URL=http://webui-host.tailnet.ts.net:5173 \
 *     node e2e/probe-iterate-k-smearing-video.mjs
 *
 * The probe expects the active project to be the shipwright-webui
 * project (its known projectId is hardcoded; matches the value used
 * by `v0-9-6-live-pty-replay.spec.ts`).
 */
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.BASE_URL ?? "http://webui-host.tailnet.ts.net:5173";
const REPORT_DIR = path.resolve(__dirname, "../playwright-report/iterate-k-smearing-video");
const SHIPWRIGHT_WEBUI_PROJECT_ID = "eab3bd8d-d89a-4b8c-aaaa-60a5ff856407";

// Capture milestones during the stress (seconds from stress-start).
const CAPTURE_TIMELINE = [3, 8, 15, 22, 30, 38];
const STRESS_DURATION_S = 40;

await fs.mkdir(REPORT_DIR, { recursive: true });

console.log(`Probe target: ${BASE_URL}`);
console.log(`Report dir:   ${REPORT_DIR}`);

/**
 * pwsh one-liner that emits sustained 256-color glyphs separated by
 * cursor-rights — the exact emit shape ADR-099 § Context calls out
 * as the bug-triggering pattern (`\x1b[38;5;Nm` runs interleaved with
 * `\x1b[1C` per-word cursor-rights).
 *
 * Uses `[Console]::Write` instead of `Write-Host -NoNewline`. Earlier
 * iteration with `Write-Host` produced rendered glyphs that all
 * appeared uniformly white in the embedded terminal — pwsh 7+'s
 * `$PSStyle.OutputRendering = "Host"` may filter or transform ANSI
 * SGR sequences emitted via the Host stream. `[Console]::Write` writes
 * raw bytes directly to stdout, bypassing the Host pipeline; xterm
 * sees the literal ESC bytes intact.
 *
 * Duration tuned to STRESS_DURATION_S: outer 400 iterations × inner
 * 80 cells × Start-Sleep 100 ms = ~40 s of sustained streaming, with
 * bursts of 80 colored glyphs delivered every ~100 ms. That matches
 * Claude's "render a chunk, pause briefly, render next chunk" cadence
 * and ensures captures at t=8/15/22/30/38 all land DURING streaming
 * rather than after the script has exited.
 *
 * Uses `[char]27` for ESC (cross-pwsh compatible). The `${clr}m`
 * delimited-variable syntax is the proper PS double-quoted form.
 *
 * The trailing `[Console]::Write("$e[0m`n")` resets SGR and emits
 * a newline so the prompt re-emerges cleanly.
 */
function buildPwshColorBlast() {
  return [
    '$e=[char]27;',
    '1..400 | % {',
    '  $r=$_;',
    '  0..79 | % {',
    '    $c=$_;',
    '    $clr=16 + ((($r * 7) + ($c * 13)) % 220);',
    '    [Console]::Write("$e[38;5;${clr}m#$e[1C")',
    '  };',
    '  [Console]::Write("$e[0m`n");',
    '  Start-Sleep -Milliseconds 100',
    '}',
  ].join(' ');
}

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

async function makeTaskCwd() {
  return fs.mkdtemp(path.join(os.tmpdir(), "iterate-k-video-"));
}

async function createTask(label) {
  const cwd = await makeTaskCwd();
  const res = await fetch(`${BASE_URL}/api/external/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `iterate-K smearing video probe (${label})`,
      cwd,
      actionId: "new-task",
      projectId: SHIPWRIGHT_WEBUI_PROJECT_ID,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`create task failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  return { taskId: j.task.taskId, cwd };
}

async function deleteTask(taskId) {
  try {
    await fetch(`${BASE_URL}/api/external/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
    });
  } catch {
    /* best-effort */
  }
}

async function runTrial({ browser, taskId, variant, trialDir }) {
  console.log(`\n--- variant=${variant} ---`);
  const stillsDir = path.join(trialDir, "stills");
  await fs.mkdir(stillsDir, { recursive: true });

  // Fresh context per trial so we get exactly one .webm per trial.
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: trialDir, size: { width: 1600, height: 900 } },
  });
  await ctx.addInitScript(spyInitScript());
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error(`  [pageerror] ${err.message}`));
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error") console.log(`  [console.error] ${msg.text().slice(0, 200)}`);
  });

  const url = `${BASE_URL}/tasks/${taskId}?atlasMaintenance=${variant}`;
  console.log(`  navigate ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
  await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 25_000 });

  // Wait for WS-ready + pty prompt.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="embedded-terminal"]');
        return el?.getAttribute("data-ws-ready") === "true";
      },
      null,
      { timeout: 25_000 },
    )
    .catch(() => console.log("  ⚠ WS-ready timeout — continuing"));
  await page.waitForTimeout(2_500);

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

  // Clear atlas log so the trial events stand alone.
  await page.evaluate(() => { window.__atlasLog = []; });

  // Focus terminal + type the pwsh colorblast.
  await page
    .locator('[data-testid="embedded-terminal-canvas"]')
    .click({ timeout: 5_000 })
    .catch(async () => {
      await page.locator(".xterm").first().click();
    });

  const colorBlast = buildPwshColorBlast();
  console.log(`  typing pwsh colorblast (${colorBlast.length} chars)`);
  // delay=8ms keeps the keystroke stream well within the WS write
  // backpressure threshold and emulates a paste-like input rate.
  await page.keyboard.type(colorBlast, { delay: 8 });
  await page.keyboard.press("Enter");
  const stressStartedAt = Date.now();
  console.log("  stress started");

  // Capture loop runs in parallel with the stress.
  const captures = CAPTURE_TIMELINE.map((tSec) => ({
    t: tSec,
    due: stressStartedAt + tSec * 1000,
    taken: false,
  }));

  while (Date.now() - stressStartedAt < STRESS_DURATION_S * 1000) {
    const now = Date.now();
    const next = captures.find((c) => !c.taken && now >= c.due);
    if (next) {
      const filename = `t${next.t}.png`;
      const filepath = path.join(stillsDir, filename);
      try {
        await page
          .locator('[data-testid="embedded-terminal-canvas"]')
          .screenshot({ path: filepath });
        next.taken = true;
        console.log(`  captured ${variant}/stills/${filename}`);
      } catch (err) {
        console.log(`  capture ${filename} failed: ${err.message}`);
        next.taken = true; // skip
      }
    }
    await page.waitForTimeout(200);
  }

  // Take a final post-stress capture (canvas at rest).
  await page.waitForTimeout(2_000);
  await page
    .locator('[data-testid="embedded-terminal-canvas"]')
    .screenshot({ path: path.join(stillsDir, "t-post-stress.png") });

  // Post-wheel capture: hover canvas + dispatch a wheel. With v8 ON
  // the DOM wheel listener fires safeAtlasMaintenance() within 150 ms.
  await page
    .locator('[data-testid="embedded-terminal-canvas"]')
    .hover({ timeout: 5_000 });
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(400);
  await page
    .locator('[data-testid="embedded-terminal-canvas"]')
    .screenshot({ path: path.join(stillsDir, "t-post-wheel.png") });

  const log = await page.evaluate(() => [...(window.__atlasLog ?? [])]);
  const byKind = {};
  for (const e of log) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  console.log(`  atlas-log: ${log.length} events ${JSON.stringify(byKind)}`);

  await fs.writeFile(
    path.join(trialDir, "atlas-log.json"),
    JSON.stringify({ preMeta, log, byKind }, null, 2),
    "utf8",
  );

  // Capture the eventual video path BEFORE closing.
  const videoObj = page.video();
  const eventualVideoPath = videoObj ? await videoObj.path() : null;

  await page.close();
  await ctx.close(); // .webm is flushed to disk here

  // Rename the video to a stable name so we don't have to grep
  // playwright-generated UUIDs from the report dir.
  if (eventualVideoPath) {
    const finalVideoPath = path.join(trialDir, "video.webm");
    try {
      await fs.rename(eventualVideoPath, finalVideoPath);
      console.log(`  video → ${path.relative(REPORT_DIR, finalVideoPath)}`);
    } catch (err) {
      console.log(`  could not rename video (${err.message}); raw path=${eventualVideoPath}`);
    }
  }

  return { variant, preMeta, byKind, logSize: log.length };
}

async function sha256(filepath) {
  try {
    const buf = await fs.readFile(filepath);
    return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

const browser = await chromium.launch({ headless: false, devtools: false });

const RESULTS = [];

for (const variant of ["off", "on"]) {
  const trialLabel = `trial-${variant}`;
  const trialDir = path.join(REPORT_DIR, trialLabel);
  await fs.mkdir(trialDir, { recursive: true });

  console.log(`\n========================================`);
  console.log(`Trial: ${trialLabel}`);
  console.log(`========================================`);

  // Each trial creates + tears down its own task so the two trials
  // are fully independent (no carryover scrollback / mount state).
  let taskId;
  try {
    const created = await createTask(variant);
    taskId = created.taskId;
    console.log(`  created task ${taskId} (cwd=${created.cwd})`);
  } catch (err) {
    console.error(`  ✗ task create failed: ${err.message}`);
    RESULTS.push({ trial: trialLabel, status: "create-error", error: err.message });
    continue;
  }

  try {
    const r = await runTrial({ browser, taskId, variant, trialDir });
    RESULTS.push({ trial: trialLabel, taskId, ...r });
  } catch (err) {
    console.error(`  ✗ trial failed: ${err.message}`);
    RESULTS.push({ trial: trialLabel, taskId, status: "trial-error", error: err.message });
  } finally {
    await deleteTask(taskId);
    console.log(`  deleted task ${taskId}`);
  }
}

// Matched-pair manifest for the user's visual inspection.
const pairs = [];
for (const tLabel of [...CAPTURE_TIMELINE.map((s) => `t${s}`), "t-post-stress", "t-post-wheel"]) {
  const off = path.join(REPORT_DIR, "trial-off", "stills", `${tLabel}.png`);
  const on = path.join(REPORT_DIR, "trial-on", "stills", `${tLabel}.png`);
  const offHash = await sha256(off);
  const onHash = await sha256(on);
  pairs.push({
    label: tLabel,
    offHash,
    onHash,
    identical: offHash != null && onHash != null && offHash === onHash,
  });
}

await fs.writeFile(
  path.join(REPORT_DIR, "results.json"),
  JSON.stringify({ baseUrl: BASE_URL, ranAt: new Date().toISOString(), results: RESULTS, pairs }, null, 2),
  "utf8",
);

console.log(`\n=== PROBE COMPLETE ===`);
console.log(`Videos:`);
console.log(`  off: ${path.join(REPORT_DIR, "trial-off", "video.webm")}`);
console.log(`  on:  ${path.join(REPORT_DIR, "trial-on", "video.webm")}`);
console.log(`Stills + atlas-log per trial under ${REPORT_DIR}`);
console.log(`\nMatched stills (hash + identical-or-differ):`);
for (const p of pairs) {
  const tag = p.identical ? "IDENTICAL" : "DIFFER";
  console.log(`  ${p.label.padEnd(15)} ${tag.padEnd(10)} off=${p.offHash} on=${p.onHash}`);
}

await new Promise((r) => setTimeout(r, 1500));
await browser.close();
