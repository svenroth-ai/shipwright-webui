# Mini-plan V7: Smart Viewer code wrap
1. CodeRenderer.tsx: `wrap` state, default true, persisted via getStored/setStored (try/catch inside) under key shipwright:viewer-wrap-lines; sticky bar with "Wrap lines" aria-pressed toggle; data-wrap attr on .smart-viewer-code.
2. New styles/smart-viewer-code.css (imported in index.css): [data-wrap="true"] pre/code -> pre-wrap + overflow-wrap:anywhere + no overflow-x + width:auto; [data-wrap] pre code -> 13px/1.6; false -> raw scroll (existing max-content rule stays).
3. Tests: vitest (toggle + persistence + CSS class fence), Playwright real-browser spec in /preview host.
Line numbers: the live viewer has none; not added.

Deviation (Sven): the 'line numbers stay aligned' clause is dropped (no gutter exists/requested); replaced by a hanging indent (text-indent:-2ch each-line + padding-left:calc(1em+2ch)). spec_impact=modify FR-01.02.

Scope update (orchestrator decision): TextRenderer (txt/log/csv) is in scope: shared WrapToggle.tsx (one stored preference), 13px/1.6, hanging indent, line number on first visual row only (gutter kept). Supersedes the earlier 'no gutter' deviation, which only held for the code view.
