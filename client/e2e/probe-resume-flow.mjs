/**
 * Headed Playwright probe — open task, click Resume, observe what happens.
 * Captures: console errors, network failures, navigation events, WS events,
 * full page reloads (load count), DOM changes.
 *
 * Run from client/:
 *   BASE_URL=http://pc-dinovo-002.tail4353f0.ts.net:5173 \
 *     node e2e/probe-resume-flow.mjs <taskId>
 */
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://pc-dinovo-002.tail4353f0.ts.net:5173';
const TASK_ID = process.argv[2] ?? '4a9fe7f2-05c7-451a-a311-57bbd85abecb';

console.log(`Probing Resume flow at ${BASE_URL}/tasks/${TASK_ID}`);

const browser = await chromium.launch({
  headless: false,
  devtools: false,
  slowMo: 50,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
});
const page = await context.newPage();

let loadCount = 0;
const wsConnects = [];
const consoleErrors = [];
const networkErrors = [];
const navigationEvents = [];

page.on('load', () => {
  loadCount++;
  console.log(`[load ${loadCount}] ${new Date().toISOString().slice(11, 23)}  url=${page.url()}`);
});
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) {
    navigationEvents.push({
      t: Date.now(),
      url: frame.url(),
    });
    console.log(`[frame-nav] ${new Date().toISOString().slice(11, 23)}  → ${frame.url()}`);
  }
});
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'error' || t === 'warning') {
    const text = msg.text().slice(0, 220);
    consoleErrors.push({ t, text });
    console.log(`[console.${t}] ${text}`);
  }
});
page.on('pageerror', (err) => {
  console.error(`[pageerror] ${err.message}`);
});
page.on('websocket', (ws) => {
  wsConnects.push({ url: ws.url(), connectedAt: Date.now() });
  console.log(`[ws OPEN] ${ws.url()}`);
  ws.on('close', () => console.log(`[ws CLOSE] ${ws.url()}`));
  ws.on('framereceived', (f) => {
    try {
      const payload = typeof f.payload === 'string' ? f.payload : f.payload.toString();
      if (payload.includes('replay_snapshot') || payload.includes('writer-promoted') || payload.includes('"type":"ready"')) {
        console.log(`[ws RECV] ${payload.slice(0, 120)}`);
      }
    } catch {}
  });
});
page.on('requestfailed', (req) => {
  networkErrors.push({ url: req.url(), failure: req.failure()?.errorText });
  console.log(`[net FAIL] ${req.url()}: ${req.failure()?.errorText}`);
});

const url = `${BASE_URL}/tasks/${TASK_ID}`;
console.log(`\nNavigating to ${url}\n`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

// Wait for embedded terminal to mount
await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 15000 }).catch(() => {
  console.log('  ⚠ embedded-terminal testid not found');
});
console.log(`\nMount complete. Snapshot reads done. Watching for 10s before clicking Resume...\n`);
await page.waitForTimeout(3000);

// Look for Resume button
const resumeButton = await page.$('[data-testid*="terminal-launch-solid-resume"], [data-testid*="resume"], button:has-text("Resume")');
if (resumeButton) {
  console.log('\n[ACTION] Found Resume button. Clicking now.\n');
  await resumeButton.click();
} else {
  console.log('\n[ACTION] Resume button NOT found. Available buttons:');
  const btns = await page.$$eval('button', (els) => els.map((e) => ({ text: e.textContent?.slice(0, 60), testid: e.getAttribute('data-testid') })));
  for (const b of btns.slice(0, 20)) console.log(`  - text="${b.text}" testid="${b.testid}"`);
}

console.log(`\nObserving for 25s after click...\n`);
await page.waitForTimeout(25000);

console.log(`\n=== SUMMARY ===`);
console.log(`  page load count: ${loadCount}`);
console.log(`  navigation events: ${navigationEvents.length}`);
console.log(`  WS connections: ${wsConnects.length}`);
console.log(`  console errors: ${consoleErrors.length}`);
console.log(`  network failures: ${networkErrors.length}`);

if (consoleErrors.length > 0) {
  console.log(`\n  Console errors (first 10):`);
  for (const e of consoleErrors.slice(0, 10)) console.log(`    [${e.t}] ${e.text}`);
}
if (networkErrors.length > 0) {
  console.log(`\n  Network errors (first 10):`);
  for (const e of networkErrors.slice(0, 10)) console.log(`    ${e.url}: ${e.failure}`);
}

console.log(`\nBrowser stays open for 10s for manual observation...`);
await page.waitForTimeout(10000);
await browser.close();
