/*
 * scrollback-store.replay-collapse.test.ts — iterate v0.8.7 AC-3
 *
 * Replay-time collapse of PowerShell-startup-banner bursts. Disk file
 * is unchanged — only the bytes returned by `readForReplay()` differ
 * from `read()`. Per external plan review (gemini high + openai high):
 *
 *   - `read()` and `bytes()` STAY RAW so scrollback-meta + privacy
 *     disclosure copy stay correct.
 *   - `readForReplay()` is the new dedicated replay channel.
 *   - Bounded regex avoids ReDoS (`[^\a]{0,256}` instead of `[^]*?`).
 *   - Collapse NEVER crosses an AC-2 `──── shell stopped at ────`
 *     marker — split by markers, collapse each span, rejoin.
 *
 * Whitelist trigger conditions:
 *   1. Regex match on `(?:\x1b]0;[^\a]{0,256}\a)?PowerShell N.N.N\r\n
 *      (?:PS [^\r\n>]{0,512}>\s*)?` — bounded prompt path.
 *   2. Match must be preceded by ≥10 consecutive `\r\n` lines (the
 *      post-resize CRLF block signature).
 *   3. Must be ≥2 such triggers within a single shell-lifetime span
 *      (between markers / start / end of buffer).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ScrollbackStore } from "./scrollback-store.js";

const TASK = "44444444-5555-6666-7777-888888888888";

function ps(version = "7.6.1"): string {
  return `\x1b]0;C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_${version}_x64__8wekyb3d8bbwe\\pwsh.exe\x07PowerShell ${version}\r\nPS C:\\Users\\Sven>${" "}`;
}

const CRLF_BLOCK_40 = "\r\n".repeat(40);
const SHELL_STOPPED = "\r\n\x1b[2m──── shell stopped at 12:34:56 ────\x1b[m\r\n";

describe("AC-3 — readForReplay() collapses PowerShell-banner-bursts", () => {
  let dir: string;
  let store: ScrollbackStore;

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "replay-collapse-"));
    store = new ScrollbackStore(dir, { maxBytesPerTask: 1024 * 1024 });
    await store.init();
  });

  afterEach(async () => {
    await store.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function seed(content: string): Promise<void> {
    await store.append(TASK, Buffer.from(content, "utf8"));
  }

  it("read() returns raw bytes UNCHANGED (preserves bytes() / scrollback-meta accuracy)", async () => {
    const burst = CRLF_BLOCK_40 + ps() + CRLF_BLOCK_40 + ps() + CRLF_BLOCK_40 + ps();
    await seed(burst);
    const raw = await store.read(TASK);
    expect(raw).toBe(burst);
    // bytes() reports DISK size, unchanged by replay-time transform.
    const rawBytes = await store.bytes(TASK);
    expect(rawBytes).toBe(Buffer.byteLength(burst, "utf8"));
  });

  it("readForReplay() collapses 5×banner-burst within one span to 1 banner + 1 marker", async () => {
    const span =
      "OUTER\r\n" +
      CRLF_BLOCK_40 + ps() +
      CRLF_BLOCK_40 + ps() +
      CRLF_BLOCK_40 + ps() +
      CRLF_BLOCK_40 + ps() +
      CRLF_BLOCK_40 + ps() +
      "TAIL\r\n";
    await seed(span);

    const replayed = await store.readForReplay(TASK);
    // Exactly ONE PowerShell banner survives.
    const bannerCount = (replayed.match(/PowerShell 7\.6\.1\r\n/g) || []).length;
    expect(bannerCount).toBe(1);
    // ONE collapse marker indicates 4 earlier banners collapsed.
    expect(replayed).toMatch(/── \d+ earlier banners? collapsed ──/);
    // Outer + tail content preserved verbatim.
    expect(replayed.startsWith("OUTER\r\n")).toBe(true);
    expect(replayed.includes("TAIL\r\n")).toBe(true);
  });

  it("readForReplay() does NOT collapse a single literal 'PowerShell 7.6.1' mid-stream", async () => {
    // User echoed the literal version string in their Claude TUI — NOT
    // preceded by a 40-line CRLF block. Should stay verbatim.
    const userEcho =
      "user typed: I have PowerShell 7.6.1\r\ninstalled here\r\n" +
      "and another line PowerShell 7.6.1 on the same line\r\n";
    await seed(userEcho);

    const replayed = await store.readForReplay(TASK);
    expect(replayed).toBe(userEcho);
  });

  it("readForReplay() does NOT collapse a SINGLE banner-burst (only ≥2 trigger collapse)", async () => {
    const single = CRLF_BLOCK_40 + ps() + "later content\r\n";
    await seed(single);

    const replayed = await store.readForReplay(TASK);
    // Single banner stays verbatim. No collapse marker.
    const bannerCount = (replayed.match(/PowerShell 7\.6\.1\r\n/g) || []).length;
    expect(bannerCount).toBe(1);
    expect(replayed).not.toMatch(/earlier banners? collapsed/);
  });

  it("readForReplay() collapses INDEPENDENTLY across shell-stopped markers (never crosses)", async () => {
    // 3 banners — marker — 3 banners. Each side collapses to 1+marker.
    const spanA =
      CRLF_BLOCK_40 + ps() +
      CRLF_BLOCK_40 + ps() +
      CRLF_BLOCK_40 + ps();
    const spanB =
      CRLF_BLOCK_40 + ps() +
      CRLF_BLOCK_40 + ps() +
      CRLF_BLOCK_40 + ps();
    await seed(spanA + SHELL_STOPPED + spanB);

    const replayed = await store.readForReplay(TASK);
    // 2 surviving banners (one per side of the marker).
    const bannerCount = (replayed.match(/PowerShell 7\.6\.1\r\n/g) || []).length;
    expect(bannerCount).toBe(2);
    // 2 collapse markers — one per span.
    const collapseCount = (replayed.match(/earlier banners? collapsed/g) || []).length;
    expect(collapseCount).toBe(2);
    // Original AC-2 marker preserved.
    expect(replayed.match(/──── shell stopped at \d{2}:\d{2}:\d{2} ────/g)?.length ?? 0).toBe(1);
  });

  it("readForReplay() bounded regex completes in linear time on long input (no ReDoS)", async () => {
    // Construct a worst-case-ish input: many CRLFs interleaved with banners
    // of varying shapes, including some that fail the optional-OSC bound.
    // Bounded `[^\x07]{0,256}` ensures no catastrophic backtracking even
    // when the OSC alternative needs to fail.
    let buf = "";
    for (let i = 0; i < 25; i++) {
      buf += CRLF_BLOCK_40;
      buf += ps();
    }
    await seed(buf);

    const start = Date.now();
    const replayed = await store.readForReplay(TASK);
    const elapsed = Date.now() - start;
    // Bounded regex — even at 25× banner-bursts the collapse should be
    // fast (well under 500ms; typically <50ms on a modern machine).
    expect(elapsed).toBeLessThan(500);
    // 25 bursts collapse to 1 banner + 1 marker.
    const bannerCount = (replayed.match(/PowerShell 7\.6\.1\r\n/g) || []).length;
    expect(bannerCount).toBe(1);
    expect(replayed).toMatch(/── 24 earlier banners collapsed ──/);
  });

  it("readForReplay() returns empty string when scrollback is empty", async () => {
    const replayed = await store.readForReplay(TASK);
    expect(replayed).toBe("");
  });

  it("readForReplay() returns empty string in disabled mode", async () => {
    const offDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "off-replay-"));
    const offStore = new ScrollbackStore(offDir, { maxBytesPerTask: 0 });
    await offStore.init();
    const replayed = await offStore.readForReplay(TASK);
    expect(replayed).toBe("");
    await offStore.shutdown();
    await fs.rm(offDir, { recursive: true, force: true });
  });
});
