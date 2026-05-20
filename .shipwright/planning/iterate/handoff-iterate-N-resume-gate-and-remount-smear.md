# Handoff: Iterate N — Resume-CTA-Gate (falsches Signal) + Re-mount-Smearing

**Vorherige Session:** PRs #14 (Iterate K v1–v9), #16 (Iterate M + ADR-099 v10), #19
(compliance-hygiene) — alle gemerged auf `main`.
**Dev-Stack:** Hono `:3847` + Vite `:5173` laufen frisch auf Tailscale
(`webui-host.tailnet.ts.net`, `SHIPWRIGHT_NETWORK_PROFILE=tailscale`).
**Auftrag:** sauberer `/shipwright-iterate` (Spec → TDD → Review → Finalize).

---

## Bug A — Resume-Button erscheint bei ALLEN aktiven Tasks (obwohl sie arbeiten)

### Befund (User-UAT 2026-05-15)
> "Alle zeigen Resume, sind aber alle am arbeiten. Alle = die Tasks von heute."

### Root cause — EMPIRISCH BESTÄTIGT
Iterate M (PR #16) führte `isPtyForegroundActive(task)` ein als Resume-Gate:
```
liveSession === true && firstJsonlObservedAt && lastPtyDataAt != null
  && (now - lastPtyDataAt) < 15_000
```

Live-curl gegen `/api/external/tasks` (2026-05-15) — JEDER aktive Task:

| Task | state | liveSession | lastPtyDataAt | lastJsonlSeenMtimeMs |
|---|---|---|---|---|
| 46f2539b | active | true  | **null** | aktuell |
| 3c693bbd | active | true  | **null** | aktuell |
| 5c85dc51 | active | false | **null** | gesetzt |
| a3f18845 | active | false | **null** | gesetzt |
| 810efeca | active | false | **null** | gesetzt |
| 4a9fe7f2 | active | false | **null** | gesetzt |

`lastPtyDataAt` ist **null bei allen** — auch bei `liveSession:true`. Grund:
`lastPtyDataAt` (Iterate M, `PtyEntry.lastPtyDataAt`, gebumpt in `pty.onData`)
ist ein **embedded-terminal-pty-Signal**. Es ist nur dann ≠ null, wenn Claude
INNERHALB der webui-embedded-terminal-pty läuft. Im Plan-D''-Default läuft
Claude im *eigenen* Terminal des Users — webui beobachtet nur die JSONL und
hostet keine pty → `liveSession=false`, `lastPtyDataAt=null` → Gate failt
auf → Resume zeigt immer. (Die `liveSession:true`-Tasks haben eine pty, aber
eine *bare shell* — Claude läuft nicht drin, daher auch dort `lastPtyDataAt`
unbestückt.)

Iterate M hat schlicht das falsche Feld erwischt. Die Unit-Tests setzten
`lastPtyDataAt` in Fixtures hart und spiegelten nie echte "Claude extern"-Daten.

### Fix-Richtung
Das **richtige** Signal ist `lastJsonlSeenMtimeMs` (epoch-ms der JSONL-Datei-
mtime — Claude schreibt Events während es arbeitet). Es ist bereits im
`ExternalTask`-Typ (`client/src/lib/externalApi.ts`) UND wird bereits vom
Server geliefert (steht in der curl-Antwort) — KEINE Server-Änderung nötig.

Das Gate (`isPtyForegroundActive` → besser umbenennen zu z.B.
`isClaudeRecentlyActive`) sollte auf `now - lastJsonlSeenMtimeMs < THRESHOLD`
gaten. Threshold großzügig wählen (JSONL-Writes sind bursty; Claude kann
zwischen Events pausieren) — Vorschlag 60_000 ms, im Spec begründen.
`altScreenActive` + `lastPtyDataAt` können als ergänzende OR-Signale bleiben
(embedded-terminal-Fall), aber `lastJsonlSeenMtimeMs` muss der Primärweg sein.

Betroffene Dateien (alle client-seitig — Server unverändert):
- `client/src/components/external/TaskDetailHeader.tsx` — `isPtyForegroundActive`
  Helper + `ctaFor()`
- `client/src/components/external/TaskCard.tsx` — Resume-Gate (nutzt den Helper)
- Tests: `TaskCard.test.tsx`, `TaskDetailHeader.test.tsx` — Fixtures auf
  `lastJsonlSeenMtimeMs`-basierte Szenarien umstellen; ein Test MUSS den
  realen Fall "Claude extern: liveSession=false, lastPtyDataAt=null,
  lastJsonlSeenMtimeMs aktuell → Resume versteckt" abdecken (genau der Fall,
  den Iterate M verfehlt hat).

### Verifikation
`curl http://webui-host.tailnet.ts.net:3847/api/external/tasks` und
`lastPtyDataAt` vs `lastJsonlSeenMtimeMs` pro Task vergleichen. Nach dem Fix:
ein Task mit aktueller JSONL-mtime darf KEIN Resume zeigen.

---

## Bug B — Smearing/Flicker wird beim Raus-und-Rein-Navigieren SCHLECHTER

### Befund (User-UAT 2026-05-15)
> "Dann gehe ich raus und rein und es flickert. … komplettes starkes smearing.
> Es muss an uns liegen, wenn wir raus und reingehen und es verschlechtert.
> Wenn es Claude wäre, dann wäre es immer das flickern."

Der User-Diagnose VERTRAUEN: "verschlechtert sich beim Re-mount" ist die
Signatur eines Leaks / einer Akkumulation im Re-attach-Pfad — NICHT Claude.
ADR-099 v10 (post-replay-snapshot `setTimeout(0)` maintenance) sollte genau
das adressieren, hat es aber nicht — oder verschlimmert es.

### Hypothesen (NICHT annehmen — empirisch falsifizieren, siehe Memory
`feedback_stop_stacking_patches`)
1. **WebGL-Context-Leak.** Jeder `EmbeddedTerminal`-Mount macht
   `new WebglAddon()` = ein WebGL2-Context. Wenn `term.dispose()` den Context
   nicht vollständig freigibt, läuft der Browser ins Context-Limit (~16);
   der älteste Context wird zwangs-verloren → Garbage-Rendering. StrictMode-
   Dev-Doppel-Mount verdoppelt die Rate. **Signatur passt: "wird schlechter".**
2. Alte disposed-xterm-Canvas/DOM nicht vollständig entfernt → gestapelte
   Render-Layer.
3. v10-Maintenance racet den replay-snapshot-Write auf frischem Mount.

### Verifikation
- DevTools-Console nach mehreren Navigate-Zyklen auf "WebGL context lost"
  Warnungen prüfen.
- `window.__embeddedTerminalWebglAddon` Test-Handle existiert bereits
  (Iterate K v8) — Context-Anzahl / `.dispose()`-Aufrufe instrumentieren.
- A/B mit dem Kill-Switch: `?atlasMaintenance=off` vs default-on, jeweils
  N× raus-und-rein, visuell vergleichen. Wenn OFF auch schlechter wird →
  NICHT die atlas-maintenance, sondern ein Mount/Dispose-Leak (Hypothese 1/2).

### Key files
- `client/src/components/terminal/EmbeddedTerminal.tsx` — Mount-Effect +
  Cleanup-Return (der `webglRef` / `term.dispose()`-Pfad). Prüfen: wird
  `webglRef.dispose()` explizit aufgerufen, oder verlässt man sich darauf,
  dass `term.dispose()` die Addons mitnimmt? xterm 6.0 WebglAddon-Dispose
  hat dokumentierte Context-Release-Fallstricke.
- `client/src/hooks/useTerminalSocket.ts` — WS-Lifecycle beim Re-attach.

---

## Prozess-Anforderung

Sauberer `/shipwright-iterate`: Spec in `.shipwright/planning/iterate/`,
TDD (RED-Tests zuerst), Code-Review, Finalize mit phase_completed Event +
CHANGELOG-Fragment. Branch `iterate/<slug>`. KEINE direkten Commits ohne
Spec — das war der Anlass dieser Handoff-Forderung.

Bug A ist klein + isoliert (client-only, falsches Feld → richtiges Feld) —
gut als erster, schnell verifizierbarer Teil. Bug B braucht echte
Browser-Investigation BEVOR Code geändert wird (Memory:
`feedback_browser_fixes_need_real_browser_smoke` +
`feedback_stop_stacking_patches`).

## Kontext-Pointer
- ADR-099 (atlas-corruption workaround v1–v10): `.shipwright/agent_docs/decision_log.md`
- Iterate M Spec: `.shipwright/planning/iterate/2026-05-15-iterate-M-resume-cta-active-state-followup.md`
- Iterate M Code-Review (nennt Finding M-1 Clock-Skew, M-3 15s-Fenster):
  `.shipwright/planning/iterate/iterate-2026-05-15-M-resume-cta-internal-code-review.md`
- Kill-Switch `?atlasMaintenance=off` — Iterate K v8, permanent in
  `EmbeddedTerminal.tsx`.
- Memory: `project_altscreenactive_is_claude_foreground` (markiert superseded
  durch Iterate M — jetzt ist klar dass AUCH `lastPtyDataAt` falsch war;
  `lastJsonlSeenMtimeMs` ist das korrekte Signal — Memory entsprechend
  aktualisieren).
