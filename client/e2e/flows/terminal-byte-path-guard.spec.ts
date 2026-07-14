/*
 * THE TERMINAL BYTE-PATH GUARD. A00 (iterate-2026-07-10-harness-hardening), AC5.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * A18 rebuilds the Files & Terminal shell into three cards around the REAL
 * xterm/pty. A restyle is allowed to move every pixel on that screen. It is NOT
 * allowed to change **what bytes reach the pty**.
 *
 * This spec pins the outbound byte sequence for a fixed set of inputs. It is the
 * invariant A18 must not move. If a refactor makes any assertion here fail, the
 * refactor changed the wire — not the paint — and that is a bug, not a baseline
 * to update.
 *
 * ── Why the existing terminal corpus does not already cover this ─────────────
 * `__ws_frame_roundtrip.test.ts` pins the SERVER→CLIENT envelopes. Nothing pinned
 * the other direction. The client's whole outbound vocabulary is one envelope —
 * `{type:"data", payload:string}` — funnelled through `socket.send` from
 * useAutoLaunch.ts (auto-execute), EmbeddedTerminal.tsx (onData + key bar). This
 * covers all three doors: auto-execute, keystroke, paste.
 *
 * ── The fences it asserts, as code rather than prose ─────────────────────────
 *   - Auto-execute is a CLIENT-side WS data-frame, never a server-side pty.write
 *     (ADR-068-A1 / DO-NOT #19), fired ONLY after an explicit CTA click, and
 *     carrying exactly the command core/launcher.ts buildCopyCommands() built.
 *   - The pty spawn target is a whitelisted SHELL, never `claude` (CLAUDE.md
 *     rule 1 / ADR-067) — asserted from the server's own `ready` envelope.
 *   - One launch = ONE frame. The double-send regressions (#186 copy-on-selection
 *     clobber, #211 right-click double-paste) were all "the client sent it twice".
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import {
  attachWsCapture,
  awaitFrame,
  isTerminalSocket,
  outboundDataFrames,
  outboundUnknownFrames,
} from "../helpers/ws-capture";

let project: SeededProject;

test.describe("@smoke A00 — terminal byte path (the A18 invariant)", () => {
  let taskId: string;
  let sessionUuid: string;
  const TITLE = "Byte path guard";

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "byte-path" });
    await setActiveProject(page, project.projectId);
    const task = await seedTask(request, { title: TITLE, projectId: project.projectId });
    taskId = task.taskId;
    sessionUuid = task.sessionUuid;
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  test("auto-execute sends EXACTLY ONE data-frame, only after the CTA click, carrying the launcher's command", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const cap = attachWsCapture(page);

    await page.goto(`/tasks/${taskId}`);

    // The WS must be ready BEFORE the click — a fast click beats the
    // attach → prewarm → manual-send park and the frame is simply never sent.
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });
    await expect(term).toHaveAttribute("data-role", "writer", { timeout: 10_000 });

    // FENCE (CLAUDE.md rule 1 / ADR-067): the pty spawned a whitelisted SHELL,
    // never `claude`. The server announces the shell it spawned in `ready`.
    const ready = await awaitFrame(
      page,
      cap,
      (f, env) => f.kind === "rx" && isTerminalSocket(f.url, taskId) && env?.type === "ready",
      { timeoutMs: 20_000 },
    );
    expect(ready, "no `ready` envelope on the terminal socket").not.toBeNull();
    const shellKind = String(ready?.env?.shellKind ?? "");
    expect(
      shellKind.toLowerCase(),
      "pty spawn target MUST be a whitelisted shell, never `claude` (rule 1 / ADR-067)",
    ).not.toContain("claude");
    // `ShellKind` is exactly this closed set (server/src/terminal/pty-manager.ts) —
    // "posix" on the Linux CI runner, "pwsh"/"cmd" on Windows. Asserting the closed
    // set (rather than a guessed list of binary names) means a NEW spawn target
    // cannot appear without this failing.
    expect(["pwsh", "cmd", "posix"]).toContain(shellKind.toLowerCase());

    // BEFORE the click: the client must not have sent a launch command. Auto-execute
    // is gated on an explicit CTA click (DO-NOT #19) — nothing else may open that door.
    const beforeClick = outboundDataFrames(cap, taskId).filter((f) =>
      f.payload.includes("claude"),
    );
    expect(
      beforeClick,
      "a launch command reached the pty WITHOUT a CTA click — auto-execute must be click-gated (ADR-068-A1 / DO-NOT #19)",
    ).toEqual([]);

    const clickAt = Date.now();
    await page.getByTestId("cta-launch-in-terminal").click();

    // Wait for the launch frame to land.
    await expect
      .poll(() => outboundDataFrames(cap, taskId, clickAt).filter((f) => f.payload.includes("claude")).length, {
        timeout: 30_000,
        intervals: [200],
      })
      .toBeGreaterThan(0);

    // Let any (buggy) duplicate settle before counting — a double-send that
    // arrives 200 ms later must FAIL this test, not slip past it.
    await page.waitForTimeout(2_000);

    const launchFrames = outboundDataFrames(cap, taskId, clickAt).filter((f) =>
      f.payload.includes("claude"),
    );

    // ── THE INVARIANT ─────────────────────────────────────────────────────────
    expect(
      launchFrames.length,
      `exactly ONE launch data-frame must reach the pty; got ${launchFrames.length}: ` +
        JSON.stringify(launchFrames.map((f) => f.payload)),
    ).toBe(1);

    const payload = launchFrames[0].payload;

    // The command is the one core/launcher.ts buildCopyCommands() built. Its args
    // are SHELL-QUOTED, and the cd-prefix is platform-specific — PowerShell emits
    //   Set-Location '<cwd>' -ErrorAction Stop; & claude --session-id '<uuid>' …
    // and POSIX emits
    //   cd '<cwd>' && claude --session-id '<uuid>' …
    // CI is Linux and the dev box is Windows, so pin the INVARIANT (which flags,
    // carrying which values) rather than one platform's quoting. Over-pinning the
    // quoting would make this guard fail on the other OS for no real reason, and a
    // guard people have to relax is a guard that ends up deleted.
    expect(
      payload,
      "launch payload must carry the PRE-BOUND --session-id (CLAUDE.md rule 2 — never regenerated)",
    ).toMatch(new RegExp(`--session-id\\s+['"]?${sessionUuid}['"]?`));
    expect(payload, "launch payload must carry the task title via --name").toMatch(
      new RegExp(`--name\\s+['"]?${TITLE}['"]?`),
    );
    expect(payload, "the launch command invokes the claude CLI").toMatch(/(^|\s|&\s*)claude\s/);
    expect(payload, "launch runs in the task's own cwd").toContain("--add-dir");

    // Submission is exactly ONE carriage return. Two CRs would submit an extra
    // empty line into the TUI; an LF would submit nothing at all on Windows.
    expect(payload.endsWith("\r"), "the launch command is submitted with a trailing CR").toBe(true);
    expect(payload.match(/\r/g)?.length, "exactly one CR — no extra submit").toBe(1);
    expect(payload, "must not be newline-terminated as well as CR-terminated").not.toContain("\n");

    // The client's ENTIRE outbound vocabulary is `data` + `resize` (see
    // ALLOWED_OUTBOUND_TYPES). Asserting nothing else exists is what makes this a
    // fence rather than a spot-check: a new frame type is a new door to the pty.
    expect(
      outboundUnknownFrames(cap, taskId, clickAt),
      "client sent an unknown frame type to the pty — the outbound vocabulary grew",
    ).toEqual([]);
  });

  test("a plain keystroke sends exactly its own bytes, one frame per key", async ({ page }) => {
    test.setTimeout(60_000);
    const cap = attachWsCapture(page);

    await page.goto(`/tasks/${taskId}`);
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });
    await expect(term).toHaveAttribute("data-role", "writer", { timeout: 10_000 });

    await page.getByTestId("embedded-terminal-canvas").click();
    const typedAt = Date.now();

    await page.keyboard.type("abc");
    await expect
      .poll(() => outboundDataFrames(cap, taskId, typedAt).map((f) => f.payload).join(""), {
        timeout: 15_000,
        intervals: [150],
      })
      .toBe("abc");

    const frames = outboundDataFrames(cap, taskId, typedAt);
    // xterm's onData fires per keystroke: 3 keys -> 3 frames, each its own byte.
    // Concatenation is asserted above; the shape is asserted here so a future
    // "helpful" coalescing/debounce change is caught rather than silently accepted.
    expect(frames.map((f) => f.payload)).toEqual(["a", "b", "c"]);
    expect(outboundUnknownFrames(cap, taskId, typedAt)).toEqual([]);
  });

  test("paste sends the whole text in a SINGLE frame (the #186/#211 double-send fence)", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const cap = attachWsCapture(page);

    await page.goto(`/tasks/${taskId}`);
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });
    await expect(term).toHaveAttribute("data-role", "writer", { timeout: 10_000 });

    const PASTED = "echo hello-from-the-clipboard";
    await page.evaluate((text) => navigator.clipboard.writeText(text), PASTED);

    await page.getByTestId("embedded-terminal-canvas").click();
    const pasteAt = Date.now();

    // xterm reads the clipboard via the ASYNC Clipboard API (a DOM `paste` event
    // never fires here) — Ctrl+V is the only faithful way to drive this path.
    await page.keyboard.press("Control+v");

    await expect
      .poll(() => outboundDataFrames(cap, taskId, pasteAt).map((f) => f.payload).join(""), {
        timeout: 15_000,
        intervals: [150],
      })
      .toBe(PASTED);

    // Let a duplicate arrive if the bug is back, THEN count.
    await page.waitForTimeout(1_500);
    const frames = outboundDataFrames(cap, taskId, pasteAt);

    expect(
      frames.length,
      `paste must reach the pty as ONE frame; got ${frames.length}: ` +
        JSON.stringify(frames.map((f) => f.payload)),
    ).toBe(1);
    expect(frames[0].payload).toBe(PASTED);
    expect(
      frames[0].payload.endsWith("\r"),
      "a paste must NOT auto-submit — the user presses Enter",
    ).toBe(false);
  });
});
