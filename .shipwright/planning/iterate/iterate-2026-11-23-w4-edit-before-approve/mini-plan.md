# Mini plan - W4 edit before approving

1. Grammar: move the line/quote split (`fencedParts`) and the pointer parser into the mirrored grammar (server + client, verbatim, drift test); the client view uses it.
2. Server: `proposed-line.ts` derives the entry's line, quotes and structured evidence pointer; `performCountersign(…, editedLine?)` validates the line (non-empty, 2000 max, must not repeat a quote), rebuilds the log block as header + key marker + `- <line>` for fenced entries (old unfenced entries unchanged), and decides edited/unedited itself.
3. Audit: `decision_countersigned` gains `edit` (`edited` | `approved_as_proposed`) and `evidence` (known pointer shape only) - never text.
4. Retry/crash safety: residue compare uses the line already logged; pre-W4 log blocks still match.
5. Client: Edit line button + labelled textarea in the row (new component), countersign sends the line; plain-language refusal messages; handlers moved to `useDecisionActions` so the modal stays under 300 lines.
6. Tests with real files (adversarial quotes), component tests, real-browser E2E; contract doc updated.
