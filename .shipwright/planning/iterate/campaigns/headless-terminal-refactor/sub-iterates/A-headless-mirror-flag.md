# Sub-Iterate: A — Headless mirror behind feature flag

## Scope

Server-side @xterm/headless mirror per live pty. SHIPWRIGHT_TERMINAL_HEADLESS_MIRROR default off. snapshot-store writes alongside legacy scrollback. M2 double-serialize stabilization. Fixture-test green on real 30986-byte log.

## Acceptance Criteria

- [ ] Flag OFF: zero behavior change; existing E2E suite green
- [ ] Flag ON: each task writes both legacy scrollback AND snapshot file; no CPU/RAM/disk regression
- [ ] Fixture test green (visible-line equality via getLine().translateToString(false)): random chunks, mid-escape splits, resize-midway (with M2 double-serialize)
- [ ] Snapshot file has versioned header (`# shipwright-snapshot v1 xterm@<ver> <cols>x<rows>`); loader rejects unknown versions
- [ ] At most N live mirrors (N = active-task-count); idle tasks have no in-memory Terminal instance
- [ ] @xterm/headless + @xterm/addon-serialize pinned to exact versions (no caret)
