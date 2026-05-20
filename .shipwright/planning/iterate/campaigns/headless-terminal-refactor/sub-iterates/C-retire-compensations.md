# Sub-Iterate: C — Retire ADR-069/077/079/086 compensations

## Scope

Delete scrollback-sanitizer.ts, collapsePowerShellBoilerplate, readForReplay(), skipReplayForNewPlain, pushdown banner-grace, safeFit dimensions-stub. ADR-087 supersedes the four. One-shot .log* wipe at first boot.

## Acceptance Criteria

- [ ] Terminal subtree LoC reduced >=25% (measure pre/post)
- [ ] All 4 real-browser smoke tests from iterate B remain green
- [ ] npm run test + npm run typecheck + npm run lint clean
- [ ] external_review.py code pass: no HIGH findings on diff
- [ ] ADR-087 merged; ADR-069/077/079/086 marked Superseded by ADR-087
- [ ] One-shot wipe of <scrollbackDir>/*.log* runs at first boot after deploy (replaces 24h TTL natural decay)
