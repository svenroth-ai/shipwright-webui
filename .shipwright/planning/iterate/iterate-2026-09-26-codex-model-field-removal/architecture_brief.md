# Architecture Brief

A Codex-runtime task-creation dialog in this webui shows a free-text
"Implementation model" input the operator wants gone entirely (no
disabled/hidden state, no exceptions), for both of the app's two
Codex-runtime modes ("Codex Light", a real `codex` CLI process; and
"Codextender", a `claude` process redirected via env vars to a local
proxy).

Options considered for what determines the model once the field is gone:
1. Send no override from the client at all; each runtime falls back to
   whatever mechanism it already has for an absent override (Codex Light:
   the `codex` CLI's own persisted `/model` choice; Codextender: a fixed
   default model alias).
2. Add a project-level Codex-model setting the client always sends
   instead of a per-task free-text field.
3. Keep the field but disable it, with an explanatory note (matching the
   existing pattern used for the Plan review / Review fields under
   Codextender).
