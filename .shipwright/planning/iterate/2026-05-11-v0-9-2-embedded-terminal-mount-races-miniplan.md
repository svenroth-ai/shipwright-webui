# Mini-Plan: v0.9.2-embedded-terminal-mount-races

- **Run ID:** iterate-2026-05-11-v0-9-2-embedded-terminal-mount-races
- **Spec:** `.shipwright/planning/iterate/2026-05-11-v0-9-2-embedded-terminal-mount-races.md`

## Approach summary

Two surgical fixes inside `client/src/components/terminal/EmbeddedTerminal.tsx` + one shared helper + one new Playwright regression spec. No server-side changes.

Branch: `iterate/v0.9.2-embedded-terminal-mount-races` from `main`.

## Work breakdown — staged commits

### Stage 0 — Test scaffolding (RED)

1. **Author** `client/e2e/flows/v0-9-2-embedded-terminal-mount-races.spec.ts` (new):
   - Reuse the WS-frame-capture pattern from `_v091-debug-resume.spec.ts` (verbatim).
   - Three test cases:
     - `AC-1: no transient readonly banner across the 1500ms grace window` — navigate to `/tasks/<TASK_ID>`, wait for `[data-testid="embedded-terminal"]` to render, then **poll-sample every 100 ms across 1500 ms** (per openai #8): `for (let i=0; i<15; i++) { samples.push(await page.evaluate(...)); await page.waitForTimeout(100); }`. Assert ALL samples returned `true` (banner element is null OR not visible). Single `.toBeHidden({timeout:1400})` could miss a transient flash.
     - `AC-2: no dimensions pageerror during mount + replay` — `page.on("pageerror", err => collected.push(err))`; navigate, wait 5s for replay envelopes to flush; assert no pageerror text matches `/dimensions|_renderService/`.
     - `AC-2b: no pageerror after Resume click` — click Resume CTA, wait 3s for auto-execute injection; same pageerror assertion.
   - Target task: `31b4076d-5a0a-4c62-b176-63553c165c03` (same as debug spec — has substantial scrollback to exercise the replay path).
   - **Config (per gemini #4):** extend `playwright.tailscale.config.ts` `testMatch` to an EXPLICIT path list (no regex): `testMatch: ['v091-tailscale-ws.spec.ts', 'v0-9-2-embedded-terminal-mount-races.spec.ts']`. Avoids accidentally globbing in underscore-prefixed diagnostic specs.
2. **Extend** `server/src/terminal/pty-manager.test.ts` (per openai #10) — append test cases to the existing writer-promotion suite:
   - `attach() returns role:reader for second connection while first holds writer`.
   - `detach(firstConn) triggers onPromoteToWriter on second-connection subscription`.
   - These are REGRESSION FENCES for the server-side contract the client's banner-grace fix depends on. No new server-side test file.

3. **Run both test files — expect FAIL** (RED). Capture failure mode in a one-line comment at the top of each spec body (so reviewers can trace which AC caught what).

### Stage 1 — AC-1 fix (banner grace, ready-anchored) (GREEN)

4. **Edit** `client/src/components/terminal/EmbeddedTerminal.tsx`:
   - Replace `const readOnly = socket.role === "reader";` (L352) with a grace-gated derived state, anchored on **`socket.ready` rising edge** (NOT taskId mount). This is the openai #2 + #3 / gemini #1 fix — a WS reconnect on the same task re-arms the grace window cleanly.
     ```ts
     const READONLY_GRACE_MS = 1500;
     const [readOnlyArmed, setReadOnlyArmed] = useState(false);
     const prevReadyRef = useRef(false);
     useEffect(() => {
       // Rising edge: socket transitions false→true (ready envelope arrived).
       // Reset armed state + start a fresh grace window. The role at this moment
       // may still be "reader" (StrictMode mount-1 holds writer), but the grace
       // window suppresses the banner until either writer-promoted fires OR
       // GRACE_MS elapses.
       if (socket.ready && !prevReadyRef.current) {
         setReadOnlyArmed(false);
       }
       prevReadyRef.current = socket.ready;
     }, [socket.ready]);
     useEffect(() => {
       // If role flips away from reader (e.g. writer-promoted), disarm + cancel
       // any pending timer (no banner re-appearance after promotion).
       if (socket.role !== "reader") {
         setReadOnlyArmed(false);
         return;
       }
       // Schedule the arm-timer with closure-local startTime. Every effect run
       // owns its own timer + cleanup; no shared state with the [socket.ready]
       // effect above so the gemini #1 ordering hazard does not apply.
       const t = setTimeout(() => setReadOnlyArmed(true), READONLY_GRACE_MS);
       return () => clearTimeout(t);
     }, [socket.role, socket.ready]);
     const readOnly = readOnlyArmed && socket.role === "reader";
     ```
   - This: (a) holds the banner hidden for the first 1500 ms after the ready envelope, (b) hides instantly on any role flip to writer (writer-promoted), (c) properly arms the banner if role IS truly stable at reader past the grace window, (d) re-arms cleanly on WS reconnect within the same EmbeddedTerminal lifetime, (e) data-send behavior stays tied to actual `socket.role` server-side gate — banner visibility is purely visual debounce (openai #9).

5. **Run Stage 0 spec AC-1 — expect GREEN.**

### Stage 2 — AC-2 fix (safeFit helper + disposedRef, brittleness-aware) (GREEN)

6. **Edit** `client/src/components/terminal/EmbeddedTerminal.tsx`:
   - Add a module-level helper above the component (per external review openai #5 + #6 + gemini #2):
     ```ts
     /**
      * Defense against two hazards: (a) post-dispose stragglers accessing
      * `term._core._renderService.dimensions` (nulled by dispose), (b) the
      * pre-renderer-ready window between `new Terminal()` and the first
      * fully-laid-out frame where `_renderService` exists but `dimensions`
      * has zero cell width/height.
      *
      * Brittleness guard (gemini #2): if `_core` or `_renderService` is
      * MISSING ENTIRELY (e.g. future xterm version renames internals), we
      * DON'T silently short-circuit — instead we fall through to fit.fit()
      * inside the try/catch. Only "renderer present but dimensions invalid"
      * short-circuits. This way a future xterm refactor breaks loudly via
      * the wrapping try/catch instead of permanently disabling resize.
      *
      * xterm version pinned to @xterm/xterm@^5 (see client/package.json).
      */
     type XtermCore = { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } };
     function safeFit(
       fit: FitAddon | null,
       term: Terminal | null,
       disposed: boolean,
     ): boolean {
       if (disposed || !fit || !term) return false;
       try {
         const core = (term as unknown as { _core?: XtermCore })._core;
         // Only short-circuit when _renderService exists (so we can probe
         // dimensions) AND dimensions reports zero cell width/height. If
         // _core or _renderService is missing entirely, fall through to
         // fit.fit() — the try/catch catches the resulting TypeError.
         if (core?._renderService) {
           const dims = core._renderService.dimensions;
           const cellW = dims?.css?.cell?.width ?? 0;
           const cellH = dims?.css?.cell?.height ?? 0;
           if (!dims || cellW === 0 || cellH === 0) return false;
         }
         fit.fit();
         return true;
       } catch {
         return false;
       }
     }
     ```
   - Add `const disposedRef = useRef(false);` next to the other refs.
   - **Cleanup ordering (openai #1 HIGH):** in the mount-effect cleanup the order MUST be:
     1. `disposedRef.current = true;` **FIRST** — any straggler async tail that wins the cleanup race short-circuits before dereferencing `_renderService`.
     2. `ro.disconnect();`
     3. `if (lastResizePendingRef.current) { clearTimeout(lastResizePendingRef.current); lastResizePendingRef.current = null; }`
     4. `onDataDispose.dispose();`
     5. `term.dispose();`
     6. `termRef.current = null; fitAddonRef.current = null;`
     7. `(window as ...).__embeddedTerminal = null;`
   - Replace all THREE `fit.fit()` source positions with `safeFit(fit, term, disposedRef.current)`:
     - L635 initial mount: `safeFit(fit, term, disposedRef.current)` (always pass the ref value, never literal `false` per openai #4).
     - L666 `resizeAndSend` body: replace `try { fit.fit(); } catch { return; }` with `if (!safeFit(fit, term, disposedRef.current)) return;`. The throttled setTimeout path AND the direct-ro-callback path share this body — both gated by one safeFit call.
     - L720 active-tab effect: replace `try { fit.fit(); } catch {}` with `safeFit(fit, term, disposedRef.current)`.
   - Reset `disposedRef.current = false` at the top of the mount effect (defensive — StrictMode's `cancelled = true` pattern in useTerminalSocket has the same shape).
   - **Additional async-tail audit (openai #12):** scan EmbeddedTerminal.tsx for any other render-triggering callbacks that can outlive cleanup. Identified surfaces: `term.write()` calls in `onData` (gated indirectly — termRef nulled in cleanup so `termRef.current?.write()` is a no-op after cleanup), `term.clear()` in `onReplayStart` (same gate), `term.scrollToBottom()` + `term.write(\r\n × rows)` in `onReplayEnd` (same gate). No additional sites need disposedRef gating because they all route through `termRef.current?.X` and the ref is nulled in cleanup step 6 — but the ordering puts cleanup step 1 (disposedRef flip) BEFORE step 6 so even a microtask that captured termRef pre-null gets short-circuited if it routes through safeFit.

7. **Run Stage 0 spec AC-2 — expect GREEN.**

### Stage 3 — Cleanup + diagnostic spec retirement

8. **Delete** `client/e2e/flows/_v091-debug-resume.spec.ts` — its WS-frame-capture logic has been replicated verbatim in the regression spec, and the new spec satisfies the v0.9.1 debug-spec purpose AS regression coverage going forward.
9. **Verify** the existing v0.9.1 spec `client/e2e/flows/v091-tailscale-ws.spec.ts` (referenced by `playwright.tailscale.config.ts`) is unaffected. If the new spec config needs to extend the tailscale config's `testMatch`, do so in the LEAST INVASIVE way (broaden the regex to match both spec files, not delete the v0.9.1 spec).

## Test strategy

| Layer | What | Where |
|---|---|---|
| Unit (server) | writer-promoted envelope fires on writer detach with reader queued | `server/src/terminal/routes.read-only-banner.test.ts` (new) |
| E2E (real Tailscale) | No transient readOnly banner during mount; no dimensions pageerror | `client/e2e/flows/v0-9-2-embedded-terminal-mount-races.spec.ts` (new) |
| Manual UAT | Real Chromium navigating to `http://webui-host.tailnet.ts.net:5173/tasks/31b4076d-...` | reproduce empty-terminal symptom; verify resolved after build |

## F0.5 Surface Verification

Surface = `web`. Runner = the new Playwright regression spec. F0.5 fails the iterate if any pageerror containing `dimensions` or `_renderService` fires during the full mount + replay + resume + auto-execute cycle.

## External LLM review (medium auto)

After Stage 0 + Stage 1 + Stage 2 land (before commit), run `uv run --with openai "C:/Users/you/.claude/plugins/cache/shipwright/shared/scripts/tools/external_review.py" --mode iterate` on the iterate diff. Expected concerns from past iterate patterns:

- Grace timer leaks across taskId change (B2c hazard) — defended by the `[taskId]` reset effect.
- `_core` private API access — pragmatic deviation from xterm's public API contract; documented in the safeFit comment + ADR-084.
- `disposedRef` racing with React 18 concurrent rendering — useRef writes in cleanup are synchronous per React docs.

## Files touched

| File | Change kind |
|---|---|
| `client/src/components/terminal/EmbeddedTerminal.tsx` | edit (banner grace + safeFit + disposedRef) |
| `client/e2e/flows/v0-9-2-embedded-terminal-mount-races.spec.ts` | new (regression fence) |
| `client/e2e/flows/_v091-debug-resume.spec.ts` | delete (logic merged into regression spec) |
| `server/src/terminal/pty-manager.test.ts` | extend (append writer-promoted regression cases per openai #10) |
| `.shipwright/planning/01-adopted/spec.md` | edit (FR-01.28 amendments AC-N + AC-N+1) |
| `client/playwright.tailscale.config.ts` | edit (explicit `testMatch` array, no regex) |
| `.shipwright/agent_docs/decision_log.md` | append ADR-084 |
| `CHANGELOG-unreleased.d/Fixed/<run_id>_001.md` | new (drop entry) |

LOC estimate: <250 LOC across all files (production code change is ~80 LOC in EmbeddedTerminal.tsx).
