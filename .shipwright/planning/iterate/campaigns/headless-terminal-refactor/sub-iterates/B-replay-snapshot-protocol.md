# Sub-Iterate: B — Replace replay protocol with snapshot envelope

## Scope

New WS envelope replay_snapshot. Default flag flip to ON. Client term.write(snapshot.data) once. Remove banner-grace pushdown. Real-browser Playwright x4.

## Acceptance Criteria

- [ ] Client never receives replay_chunk envelopes for tasks created in iterate B (legacy fallback only for old tasks)
- [ ] Visible buffer post-attach matches mirror visible buffer line-by-line (M2 ensures this)
- [ ] SHIPWRIGHT_TERMINAL_HEADLESS_MIRROR=1 default in config.ts
- [ ] 4 real-browser smoke tests pass (Playwright vs xterm.js DOM): new-plain Claude TUI re-attach, plain shell re-attach, completed-task replay-only, mid-session resize+refresh
- [ ] Multi-tab attach unchanged (snapshot is per-task)
- [ ] Snapshot version mismatch falls back to legacy chunked path
