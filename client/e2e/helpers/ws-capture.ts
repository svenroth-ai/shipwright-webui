/*
 * WebSocket frame-capture helper for Playwright specs.
 *
 * Extracted from `C5-embedded-terminal-split-smoke.spec.ts` (campaign
 * 2026-05-25-bloat-cleanup-C-webui sub-iterate C5 follow-up) to stay
 * under the 300-LOC file ceiling. Original prior art for the capture
 * shape: `client/e2e/flows/76-autolaunch-reader-writer-race.spec.ts`.
 *
 * Scope: low-level frame buffering + envelope parsing only. Spec-
 * specific filters (e.g. "ready frame on the terminal WS for taskId
 * after click time") live in the spec file using these primitives.
 *
 * Design choices the external review (gemini #1 HIGH, openai #3/#4
 * MED) drove:
 *   - Buffer-safe payload coercion (PWWebSocket `framesent`/`framereceived`
 *     payloads are `string | Buffer`; we coerce to UTF-8 string).
 *   - Each captured WS records its `openedAt` so the spec can ignore
 *     stale-socket frames from prior page state.
 *   - `tryParseEnvelope` trims leading whitespace, guards on `{`, and
 *     swallows parse errors — never throws.
 */

import type { Page, WebSocket as PWWebSocket } from "@playwright/test";

export type FrameKind = "open" | "tx" | "rx" | "close";

export interface CapturedFrame {
  ts: number;
  kind: FrameKind;
  socketId: number;
  url: string;
  text: string;
}

export interface WsCapture {
  frames: CapturedFrame[];
  sockets: Map<number, { openedAt: number; url: string }>;
}

/**
 * Attach a WebSocket capture to `page`. The capture is live for the
 * lifetime of the Page; create a fresh one after a reload if you want
 * a clean buffer for the post-reload assertions.
 */
export function attachWsCapture(page: Page): WsCapture {
  const frames: CapturedFrame[] = [];
  const sockets: WsCapture["sockets"] = new Map();
  let nextSocketId = 1;

  page.on("websocket", (ws: PWWebSocket) => {
    const socketId = nextSocketId++;
    const url = ws.url();
    const openedAt = Date.now();
    sockets.set(socketId, { openedAt, url });
    frames.push({ ts: openedAt, kind: "open", socketId, url, text: url });

    ws.on("framesent", (f) => {
      frames.push({
        ts: Date.now(),
        kind: "tx",
        socketId,
        url,
        text: coercePayload(f.payload),
      });
    });
    ws.on("framereceived", (f) => {
      frames.push({
        ts: Date.now(),
        kind: "rx",
        socketId,
        url,
        text: coercePayload(f.payload),
      });
    });
    ws.on("close", () => {
      frames.push({ ts: Date.now(), kind: "close", socketId, url, text: url });
    });
  });

  return { frames, sockets };
}

function coercePayload(payload: string | Buffer): string {
  if (typeof payload === "string") return payload;
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  return "";
}

/**
 * Safely parse a frame payload as a JSON envelope. Returns `null` on
 * non-string, non-JSON, or non-object payloads — caller filters out
 * the null rows.
 */
export function tryParseEnvelope(text: string): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Poll `cap.frames` until a frame matching `predicate` appears OR
 * `timeoutMs` elapses. Returns the matched frame with its parsed
 * envelope, or `null` on timeout.
 */
export async function awaitFrame(
  page: Page,
  cap: WsCapture,
  predicate: (frame: CapturedFrame, env: Record<string, unknown> | null) => boolean,
  opts: { timeoutMs: number; pollMs?: number } = { timeoutMs: 30_000 },
): Promise<{ frame: CapturedFrame; env: Record<string, unknown> | null } | null> {
  const pollMs = opts.pollMs ?? 100;
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    for (const f of cap.frames) {
      const env = f.kind === "rx" || f.kind === "tx" ? tryParseEnvelope(f.text) : null;
      if (predicate(f, env)) return { frame: f, env };
    }
    await page.waitForTimeout(pollMs);
  }
  return null;
}

/**
 * URL filter for the terminal WebSocket of a specific task. The WS URL
 * shape is `ws(s)://<host>/api/terminal/<taskId>/ws`. Path-substring
 * matching is sufficient because `taskId` is a v4 UUID — accidental
 * collisions elsewhere in the page are practically impossible.
 */
export function isTerminalSocket(socketUrl: string, taskId: string): boolean {
  return socketUrl.includes(`/api/terminal/${taskId}/`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * OUTBOUND capture. A00 (iterate-2026-07-10-harness-hardening), AC5.
 *
 * Everything above this line is about what the SERVER sends. The bytes that
 * matter for A18 are the ones the CLIENT sends: A18 rebuilds the Files & Terminal
 * shell around a real xterm, and a restyle must not be able to change WHAT BYTES
 * REACH THE PTY. The client's entire outbound vocabulary is a single envelope —
 * `{type:"data", payload:string}` (useAutoLaunch.ts, EmbeddedTerminal.tsx,
 * TerminalKeyBar.tsx all funnel through `socket.send`) — so pinning it is cheap
 * and total.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The one envelope the client is allowed to send to the pty. */
export interface OutboundDataFrame {
  ts: number;
  socketId: number;
  payload: string;
}

/**
 * Total bytes of pty OUTPUT the page has received for a task.
 *
 * This is the honest way to know a terminal has accumulated real scrollback. The
 * obvious alternative — reading the terminal's `textContent` — does not work: the
 * WebGL renderer paints to a canvas, so the DOM only carries xterm's injected
 * <style> block, and a poll on it silently waits forever on the wrong string.
 */
export function inboundDataBytes(cap: WsCapture, taskId: string, sinceTs = 0): number {
  let total = 0;
  for (const f of cap.frames) {
    if (f.kind !== "rx" || f.ts < sinceTs) continue;
    if (!isTerminalSocket(f.url, taskId)) continue;
    const env = tryParseEnvelope(f.text);
    if (env?.type === "data" && typeof env.payload === "string") total += env.payload.length;
  }
  return total;
}

/**
 * Every outbound `{type:"data"}` frame on the given task's terminal socket, in
 * send order, optionally restricted to frames sent after `sinceTs` (use the
 * click timestamp to ignore prewarm/replay chatter from earlier page state).
 */
export function outboundDataFrames(
  cap: WsCapture,
  taskId: string,
  sinceTs = 0,
): OutboundDataFrame[] {
  const out: OutboundDataFrame[] = [];
  for (const f of cap.frames) {
    if (f.kind !== "tx" || f.ts < sinceTs) continue;
    if (!isTerminalSocket(f.url, taskId)) continue;
    const env = tryParseEnvelope(f.text);
    if (!env || env.type !== "data") continue;
    if (typeof env.payload !== "string") continue;
    out.push({ ts: f.ts, socketId: f.socketId, payload: env.payload });
  }
  return out;
}

/**
 * The COMPLETE outbound vocabulary the client is allowed to speak to a pty:
 *
 *   data   — keystrokes, paste, and the auto-execute launch command
 *            (useAutoLaunch.ts, EmbeddedTerminal.tsx, TerminalKeyBar.tsx)
 *   resize — pty size sync. Load-bearing, not cosmetic: a pty whose column count
 *            disagrees with xterm's makes Claude wrap its own TUI at the wrong
 *            width and smears the input line (#194). `useTerminalSizeSync` sends
 *            this on mount and before launch.
 *
 * Anything else appearing on the wire means the client grew a NEW way to talk to
 * the pty that no guard covers.
 */
export const ALLOWED_OUTBOUND_TYPES = ["data", "resize"] as const;

/**
 * Outbound frames whose `type` is outside `allowed`. Asserting this is empty is
 * what turns the byte-path guard from "the frames I thought to check are right"
 * into "no OTHER frames exist" — the difference between a spot-check and a fence.
 */
export function outboundUnknownFrames(
  cap: WsCapture,
  taskId: string,
  sinceTs = 0,
  allowed: readonly string[] = ALLOWED_OUTBOUND_TYPES,
): string[] {
  const out: string[] = [];
  for (const f of cap.frames) {
    if (f.kind !== "tx" || f.ts < sinceTs) continue;
    if (!isTerminalSocket(f.url, taskId)) continue;
    const env = tryParseEnvelope(f.text);
    if (!env || typeof env.type !== "string" || !allowed.includes(env.type)) {
      out.push(f.text);
    }
  }
  return out;
}
