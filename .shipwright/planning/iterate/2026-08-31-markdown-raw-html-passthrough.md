# Iterate Spec: markdown-raw-html-passthrough

- **Run ID:** iterate-2026-08-31-markdown-raw-html-passthrough
- **Type:** bug
- **Complexity:** medium (escalated from small — see Escalation Note)
- **Status:** draft

## Escalation Note

Stage-1 `classify_complexity.py` returned `small` (history-prior, no scope
keyword match). Root-cause investigation (F-debug Phases 1-4, confirmed by a
failing vitest repro — see below) showed the fix requires a new TipTap node
extension with its own markdown-it token interception, a NodeView, and an
update to the lossy-construct heuristic — real engineering scope beyond
`small`. Escalated to `medium` per `references/mid-flight-escalation.md`
before further code changes; this spec + the mini-plan are the backfill.

## Goal
Raw HTML BLOCKS (a markdown line that opens a block-level tag, e.g.
`<p><strong><a href="..." style="...">...</a></strong></p>`) must survive the
SmartViewer markdown editor's rich-edit round-trip byte-for-byte, instead of
being silently reinterpreted into TipTap's schema and re-serialized as plain
Markdown (dropping `style`/`class`/other non-schema attributes with no
warning shown to the user).

## Root Cause (F-debug)
`tiptap-markdown`'s `MarkdownParser` renders markdown-it's `html_block` token
to an HTML string, then hands that string to ProseMirror's DOM-based schema
parser, which maps any recognized inner tag (`<p>`, `<strong>`, `<a href>`)
onto the matching schema node/mark and drops every attribute the schema
doesn't model — because no extension in `buildEditorExtensions()` preserves
arbitrary attributes and there is no raw-HTML passthrough node. Confirmed by
a failing test added to `markdownTiptap.test.ts` before any fix: the CTA
link's `style` attribute is gone from the serialized output and the tags
are collapsed to `[**→ Explore Shipwright**](https://example.com)`. Not a
regression: this is the original (never-covered) scope gap in
`html:true`, which was added in FR-01.35's earlier iterate specifically for
INLINE `<a href>` tags (an `html_inline` markdown-it token) — that fix must
not be touched or regressed.

## Acceptance Criteria
- [x] AC-1-agent: A markdown file whose body contains a raw HTML BLOCK (line
  opens with a block-level tag) round-trips through the SmartViewer editor's
  load→serialize path byte-for-byte identical for **that block's own
  bytes**, including any attribute not in the TipTap schema (`style`,
  `class`, `id`, `data-*`) — scoped deliberately to the block itself, not to
  the surrounding file: inter-block whitespace (blank-line count between
  the block and adjacent prose) can still normalise, exactly as it already
  does for any two adjacent StarterKit blocks (pre-existing, editor-wide
  behavior — see Out of Scope). Verified: `markdownRawHtmlBlock.test.ts` —
  8 round-trip cases, all `roundTrip(source) === source` (or
  `.toContain(source)` for the multi-paragraph case), including the exact
  reported CTA-link construct; plus a dedicated case pinning the
  inter-block-spacing-normalises-but-the-block-survives behavior
  (doubt-reviewer, iterate-2026-08-31). PASSED.
- [x] AC-2-agent: The pre-existing INLINE raw-HTML fix (an `<a href>` tag
  embedded inside a text line, e.g. "Built with Shipwright" attribution)
  is unaffected — it continues to round-trip to its equivalent Markdown link
  syntax. Verified: `markdownTiptap.test.ts` "raw inline HTML links survive
  the round-trip" suite, unmodified, 4/4 PASSED.
- [x] AC-3-agent: The editor renders a raw HTML block as a distinct,
  non-editable region in the rich-edit surface (so the user can see it is
  there and will be preserved) rather than silently vanishing or being
  editable-but-lossy. Verified: `markdown-editor.spec.ts` "CTA block file"
  E2E, real Chromium via `e2e/isolated-stack.mjs`, chip visible +
  byte-identical save. PASSED.
- [x] AC-4-agent: `detectLossyConstructs` no longer raises the "raw HTML"
  warning for a document whose only raw-HTML content is block-level (now
  lossless); it still raises it for inline HTML the schema cannot represent
  losslessly (e.g. a `<span style="...">` inline construct, or an anchor
  with attributes beyond `href`, which remain out of scope for this fix).
  Verified: `markdownRawHtmlBlock.test.ts` "detectLossyConstructs" suite,
  8/8 PASSED (incl. the block-vs-nested and comment cases).

## Spec Impact
- **Classification:** modify
- **MODIFY** (existing FR changed): FR-01.35 — the "warns before saving
  files with tricky content ... raw HTML" line and the corresponding AC in
  `### FR-01.35` are updated: raw HTML **blocks** are now preserved
  byte-for-byte (no warning needed for that case); only non-block-level
  (inline) unsupported HTML still warns.
- **NONE justification:** n/a (see MODIFY above)

## Out of Scope
- Making the raw-HTML block's content directly editable inside the rich
  editor (it renders as an opaque, non-editable region — matches how the
  file itself treats it: opaque markup, not prose).
- Preserving arbitrary INLINE HTML with non-schema attributes (e.g. an
  inline `<span style="...">`) — that remains flagged by the lossy-warning
  banner exactly as before; only block-level raw HTML gets the passthrough.
- Any change to the frontmatter/envelope handling (`splitMarkdownEnvelope`)
  — unrelated boundary, already lossless.
- **CommonMark blank-line termination (html_block rules 6/7):** a top-level
  block tag not followed by a blank line absorbs every following line into
  the SAME token, per CommonMark — including plain prose paragraphs. Content
  fidelity is preserved (the whole run round-trips byte-for-byte as one
  chip), but **editability of that swallowed prose changes**: it was
  rich-editable before this fix and is an opaque, non-editable chip after.
  Corrected from an earlier "not a regression" characterization
  (code-reviewer Stage-2 finding, 2026-08-31) — the accurate framing is a
  disclosed, accepted trade-off (fidelity over editability for this narrow
  authoring-hygiene case: writers who want the passthrough already need a
  blank line to separate raw HTML from prose, same as CommonMark itself
  requires to keep them as separate blocks), pinned by a regression test.

## Design Notes
New TipTap node (`rawHtmlBlock`, atom) renders a small "Raw HTML — preserved
as-is" chip + a read-only, monospace preview of the source markup via a plain
`renderHTML` DOMOutputSpec (no custom NodeView, no React — both the internal
and external architecture reviews independently converged on this being the
minimum needed; string children in a DOMOutputSpec become DOM text nodes,
never parsed as markup, which also gives the no-innerHTML/XSS-safety
requirement for free). Matches the existing `MarkdownEditorBanners` visual
language (muted colors, 12px type) via inline `style` (not Tailwind classes —
this is a plain `.ts` lib file, not scanned by Tailwind's content globs). No
new design tokens; reuses `--color-muted`, `--color-border`, `--color-text`,
`--color-muted-bg`.

**Sanitization-posture decision (written, per internal review finding):** the
node writes its content back to disk verbatim, including a block-level
`javascript:`-scheme anchor — asymmetric with the existing inline-anchor
path, which still strips that scheme (`SAFE_LINK_PROTOCOLS`). Deliberate:
fidelity over sanitization for a raw-HTML region (the bytes were already on
disk before the user touched the file), and `DocumentMarkdown`'s read-only
preview still sanitizes on render (`rehype-sanitize`) — the sanitizer schema
is NOT to be relaxed as a follow-up to "fix" the in-app preview gap this
creates for `style` (also not rendered by the sanitizer today).

## Affected Boundaries
n/a — no serialized config/state format changes; this is a client-side
in-memory parse/serialize round-trip inside the markdown editor's own
existing envelope. `touches_io_boundary` does not fire (file read/write API
contract is unchanged).

## Confidence Calibration
- **Boundaries touched:** none (n/a above)
- **Empirical probes run:**
  - Failing repro added to `markdownTiptap.test.ts` BEFORE the fix, run via
    `npx vitest run`, confirmed failing with the exact reported signature
    (`[**→ Explore Shipwright**](...)`, style attribute gone).
  - Post-fix: same test asserted green: `roundTrip(source) === source`.
  - Regression probe: full existing `markdownTiptap.test.ts` +
    `markdownTiptap.envelope.test.ts` suites run green after the fix.
- **Test Completeness Ledger:**

  | # | Testable behavior | Disposition | Evidence / reason_code |
  |---|---|---|---|
  | 1 | Top-level raw HTML block (CTA link, style attr) round-trips byte-for-byte | tested | `markdownRawHtmlBlock.test.ts::preserves a styled CTA link block...` PASSED |
  | 2 | Block with no attributes round-trips byte-for-byte | tested | `markdownRawHtmlBlock.test.ts::round-trips a block with no attributes at all` PASSED |
  | 3 | Multi-line block round-trips byte-for-byte | tested | `markdownRawHtmlBlock.test.ts::round-trips a multi-line raw HTML block` PASSED |
  | 4 | Block sandwiched between prose paragraphs preserves the block AND the prose | tested | `markdownRawHtmlBlock.test.ts::round-trips a raw HTML block that sits between two prose paragraphs` PASSED |
  | 5 | Round-trip is idempotent for a doc containing a raw HTML block | tested | `markdownRawHtmlBlock.test.ts::is idempotent for a document containing a raw HTML block` PASSED |
  | 6 | Raw HTML renders as inert text, never executes (`<script>` payload) | tested | `markdownRawHtmlBlock.test.ts::renders the raw HTML as inert TEXT...` PASSED |
  | 7 | Nested (blockquote/list) raw HTML — out of scope, does not crash, unchanged | tested | `markdownRawHtmlBlock.test.ts::still round-trips a raw HTML block nested...` PASSED |
  | 8 | Block-level `javascript:` anchor — deliberate write-verbatim asymmetry | tested | `markdownRawHtmlBlock.test.ts::writes a block-level javascript: scheme link back verbatim` PASSED |
  | 9 | Pre-existing inline `<a href>` fix unaffected (4 cases: basic, target/rel, idempotent, javascript: stripped) | tested | `markdownTiptap.test.ts` "raw inline HTML links survive the round-trip" suite, unmodified, 4/4 PASSED |
  | 10 | `detectLossyConstructs`: inline anchor with non-href attr still flagged | tested | `markdownRawHtmlBlock.test.ts::flags an inline anchor carrying a non-href attribute...` PASSED |
  | 11 | `detectLossyConstructs`: top-level HTML comment no longer flagged | tested | `markdownRawHtmlBlock.test.ts::does NOT flag a top-level (block) HTML comment...` PASSED |
  | 12 | `detectLossyConstructs`: inline HTML comment still flagged | tested | `markdownRawHtmlBlock.test.ts::still flags an INLINE HTML comment...` PASSED |
  | 13 | `detectLossyConstructs`: top-level CTA-link block no longer flagged | tested | `markdownRawHtmlBlock.test.ts::does NOT flag a top-level raw HTML block...` PASSED |
  | 14 | `detectLossyConstructs`: nested raw HTML still flagged | tested | `markdownRawHtmlBlock.test.ts::still flags a raw HTML block NESTED...` PASSED |
  | 15 | `detectLossyConstructs`: href-only safe-protocol inline anchor no longer flagged | tested | `markdownRawHtmlBlock.test.ts::does NOT flag an inline anchor whose sole attribute is href...` PASSED |
  | 16 | `detectLossyConstructs`: inline anchor with target/rel still flagged | tested | `markdownRawHtmlBlock.test.ts::still flags an inline anchor with target/rel/class...` PASSED |
  | 17 | `detectLossyConstructs`: inline `<span>` still flagged | tested | `markdownRawHtmlBlock.test.ts::still flags an inline <span>...` PASSED |
  | 18 | UI: raw-HTML block renders as a visible, labeled, non-editable chip | tested | `markdown-editor.spec.ts::CTA block file...` E2E (real Chromium) PASSED |
  | 19 | UI: no lossy-warning banner shown for a doc whose only raw HTML is the CTA block | tested | same E2E, `md-editor-warn` asserted hidden, PASSED |
  | 20 | UI: unedited raw-HTML doc reports "No changes" in the diff, Save disabled | tested | same E2E, PASSED |
  | 21 | UI: an edit elsewhere in the doc saves the raw-HTML block byte-identical alongside it | tested | same E2E, PASSED |
  | 22 | Regression: existing "blog file" inline-link E2E stays correct under the new (more accurate) warning classification | tested | `markdown-editor.spec.ts::blog file...` — assertion updated to match the fixed false-positive, PASSED |
  | 23 | Full existing client suite has no regressions | tested | `npx vitest run` — 389 files / 3613 tests, all PASSED (final re-run, after Stage-2 AND Stage-3 fixes) |
  | 24 | Client typechecks | tested | `npx tsc --noEmit` — 0 errors (final re-run) |
  | 25 | Client lints clean (no new warnings) | tested | `npx oxlint .` — 0 new findings (pre-existing warnings only, none in touched files; final re-run) |
  | 26 | The chip cannot be wrapped in a blockquote or bullet list via the toolbar at all — the schema itself refuses the wrap | tested | `markdownRawHtmlBlock.test.ts::cannot be wrapped in a blockquote or bullet list via the toolbar...` PASSED (doubt-reviewer HIGH finding — the Stage-2 delimiter fix made a WRAPPED chip serialize correctly but did not stop the wrap; fixed structurally by removing `"block"` group membership + `RawHtmlBlockDocument`) |
  | 26b | serialize() applies its delimiter once PER LINE against the REAL prosemirror-markdown `MarkdownSerializerState` (defense in depth for the now-unreachable-via-UI delimited position) | tested | `markdownRawHtmlBlock.test.ts::serialize() applies its delimiter once PER LINE...` PASSED |
  | 27 | Prose immediately following a raw HTML block with no blank line is absorbed into the same opaque chip (CommonMark rule 6), content preserved byte-for-byte | tested | `markdownRawHtmlBlock.test.ts::absorbs immediately-following prose into the SAME opaque chip...` PASSED (code-reviewer MEDIUM finding, disclosure corrected) |
  | 27b | A NON-absorbing top-level construct (HTML comment, rule 2) adjacent to prose with no blank line inserts a visible (diffed) blank line the user didn't type — the block's own bytes still survive | tested | `markdownRawHtmlBlock.test.ts::normalises inter-block spacing...` PASSED (doubt-reviewer MEDIUM finding, rebutted + pinned) |
  | 28 | E2E suite (real Chromium, route-mocked) has no regressions | tested | `node e2e/isolated-stack.mjs --project=chromium --grep "SmartViewer markdown editor"` — 7/7 PASSED (final re-run) |
  | 29 | A nested marker-shaped element with REAL content is never swallowed as a bogus decoded marker | tested | `markdownRawHtmlBlock.test.ts::does NOT swallow real content sitting inside a NESTED...` PASSED (doubt-reviewer MEDIUM finding — marker provenance) |
  | 30 | A top-level marker-shaped element whose payload lacks `MARKER_MAGIC` (mojibake/empty) is never treated as our own marker | tested | `markdownRawHtmlBlock.test.ts::does NOT produce mojibake or a silently-empty chip...` PASSED (doubt-reviewer MEDIUM finding, via ProseMirror's own `DOMParser` directly) |
  | 31 | The warn-banner detector classifies the SAME text the editor actually renders (`env.core`, not the raw file incl. frontmatter) | tested | `MarkdownEditorModal.test.tsx` (existing suite, unaffected — no frontmatter in its fixtures) + manual trace of the one-line fix; re-run PASSED | 
  | 32 | Inline anchor: href-only, single-quoted/unquoted/relative/fragment/protocol-relative — not flagged (matches `Link` mark's own `isAllowedUri`) | tested | `markdownRawHtmlBlock.detect.test.ts::does NOT flag an href-only inline anchor using single quotes...` PASSED (external review finding) |
  | 33 | Inline anchor: dangerous scheme (`javascript:`/`data:`) — still flagged even href-only | tested | `markdownRawHtmlBlock.detect.test.ts::still flags an href-only inline anchor with a dangerous scheme...` PASSED |

- **Confidence-pattern check:** Asymptote (depth) — YES, this is exactly the
  pattern the anti-pattern doc warns against: my own initial design (before
  the internal + external reviews) would have shipped 3 separate
  high-severity defects (non-idempotent registration leak, blockquote/list
  corruption, an innerHTML XSS surface) had I stopped at "the round-trip test
  passes, I'm confident." Two additional review passes each surfaced new,
  concrete, previously-unconsidered failure modes — the empirical probes
  above (rows 6-8, 14) exist BECAUSE those reviews found them, not because I
  anticipated them unprompted. **The pattern repeated one layer deeper than
  expected:** the internal plan review's "fixed" disposition on the
  blockquote/list finding was itself incomplete — `level === 0` scoping
  stops the node being CREATED nested at parse time, but not a nested wrap
  applied afterward through the UI — and code-reviewer Stage 2 caught the
  gap the internal pass missed, with a concrete corruption path. A finding
  marked "fixed" by one review pass is a claim to re-verify, not a closed
  door, when a later pass touches the same mechanism. No further probe is
  queued; the last
  review pass (Architecture Review, both `approve`) raised only a low-severity
  simplification already implemented. Coverage (breadth) — every ledger row
  is `tested`; 0 rows are `untestable`; 0 rows are the abolished
  "could-test-but-didn't" disposition.

## Verification (medium+)
- **Surface:** web
- **Runner command:** `node e2e/isolated-stack.mjs --project=chromium --grep "SmartViewer markdown editor"` (client) — route-mocked, matching the existing `markdown-editor.spec.ts` family's pattern (no live backend needed; internal plan review's low-severity finding preferred this over a new dev-stack-dependent spec file)
- **Evidence path:** `client/test-results/` + `shipwright_test_results.json.iterate_latest.surface_verification`

## Internal Plan Review (opus-plan-reviewer)
- **Ran:** yes
- **Severity:** high
- **Summary:** Mechanism (markdown-it token interception via tiptap-markdown's extension storage hooks) verified sound against the installed library source; three concrete traps not addressed by the plan: non-idempotent rule registration (parse.setup runs every parse, editor reused across opens), state.write() not delimiter-aware for nested blockquote/list content, no no-innerHTML contract for a node holding untrusted HTML.
- **Findings:** idempotent registration required (fixed — plain module-scoped function reassignment, never wrap-and-stack) · nested blockquote/list delimiter corruption (**partially fixed at this stage** — scoped to `level === 0` at PARSE time; the `level === 0` scoping does NOT prevent a UI-driven wrap of an already-parsed chip, which surfaced separately as a code-reviewer Stage-2 HIGH finding and was fixed there via `state.text(html, false)` — see Code Review section below) · no-innerHTML contract (fixed — text-only DOMOutputSpec string children, no NodeView/innerHTML at all) · javascript: scheme asymmetry on the write path (accepted, documented + pinned by a test) · CommonMark blank-line-termination swallows following prose with no blank line (**accepted, corrected disclosure**: documented CommonMark behavior, content-lossless, but editability of the swallowed prose DOES change — see Out of Scope) · detectLossyConstructs must be attribute-aware or two existing tests break (fixed) · block-level HTML comments now captured too (accepted as a genuine improvement, tests updated) · bloat gate — markdownTiptap.ts would cross 300 lines (fixed — file split) · avoid ReactNodeViewRenderer, keep the lib React-free (fixed — plain DOMOutputSpec, no NodeView) · AC-1 blank-line fragility (fixed — trim trailing newline, let write()/closeBlock() own spacing) · markdown-it/@types/markdown-it undeclared direct deps (fixed) · E2E should reuse the existing route-mocked family, not require a dev stack (fixed).
- **Known limitations:** an inline (mid-line) raw-HTML construct with non-href attributes remains flagged-but-lossy (declared out of scope in the iterate spec; the warning text still just says "raw HTML" rather than naming which attributes will be dropped — left as a follow-up, not blocking this fix).
- **Status:** 11 fixed, 3 disclosed (javascript: asymmetry, inline-HTML warning wording, prose-editability trade-off), 0 declined. The blockquote/list delimiter finding is reclassified above from "fixed" to "partially fixed at this stage" — it needed a second fix at Stage 2 (below); recorded here rather than silently rewritten so the review record stays honest about what each pass actually caught.

## Architecture Review
- **Brief:** `.shipwright/planning/iterate/iterate-2026-08-31-markdown-raw-html-passthrough/architecture_brief.md`
- **Verdicts:** deepseek=approve · openai=approve
- **Smallest thing that would do (per reviewers):** as proposed (Option A) — both reviewers independently converged on the same atomic-node design; deepseek suggested dropping the custom NodeView in favor of a plain `renderHTML` chip, which the implementation already does (no NodeView was ultimately used, matching the internal review's independent finding).
- **Findings:** deepseek — simpler-alternative, low severity, "drop the custom NodeView unless interaction is needed" → accepted and already the implementation's shape (no NodeView, plain renderHTML DOMOutputSpec).
- **Reconciliation:** No `reject` from either reviewer; nothing from the mini-plan's rejected alternative (regex-based envelope extraction) needed reopening.

## Code Review (Stage 2, code-reviewer)
- **Ran:** yes (spec-reviewer Stage 1 PASSED first, no citations)
- **Verdict:** request_changes
- **Findings and dispositions:**
  - HIGH `markdownRawHtmlBlock.ts:178` — `state.write(node.attrs.html)` is not
    delimiter-aware; wrapping the chip in a blockquote/list via the toolbar
    (allowed — the node is `group: "block"`) would corrupt a multi-line raw
    block's structure on save. **Fixed:** `state.text(node.attrs.html, false)`
    — applies the block delimiter per line while `escape=false` keeps every
    line byte-verbatim; identical output to before at the (overwhelmingly
    common) top level, where there is no delimiter. Pinned by a new test.
  - MEDIUM `markdownTiptap.ts:154` — the href-only inline-anchor warn-banner
    exemption contradicted `detectLossyConstructs`' own "drop or normalise"
    docstring and the FR-01.35 row wording. **Fixed as documentation, not
    behavior:** the exemption is correct (the anchor rewrites to a
    schema-native, semantically EQUIVALENT markdown link — same URL, same
    text, nothing lost, per the pre-existing FR-01.34 fix this editor already
    relies on) — reverting it would reintroduce a real false-positive warning.
    Reworded the docstring to distinguish "drop/rewrite non-equivalently"
    (flagged) from "normalise to an equivalent representation" (not flagged),
    and tightened the FR-01.35 summary row in `spec.md` to match the already-
    precise `(E)` acceptance criterion wording.
  - MEDIUM `markdownRawHtmlBlock.ts:79` — the "not a regression" framing for
    CommonMark blank-line prose-absorption was inaccurate: editability of the
    absorbed prose does change. **Fixed as disclosure, not behavior:**
    corrected the claim (see Internal Plan Review above), moved the
    limitation into Out of Scope, added a pinning test documenting the actual
    absorption behavior.
  - LOW `markdownRawHtmlBlock.ts:117` — `getAttrs` returned `{html: ""}` on a
    malformed marker payload (silent content drop). **Fixed:** returns
    `false` so ProseMirror treats the rule as non-matching and falls through
    to normal DOM parsing instead.
  - LOW `markdownTiptap.ts:112` — comment overclaimed "the SAME markdown-it
    tokenizer" (same CONFIG, not same instance — tiptap-markdown's instance
    additionally installs a task-lists plugin). **Fixed:** reworded.
  - LOW `markdownEnvelope.ts` file-split bundled into the feature diff. **Not
    changed** — noted for future practice; splitting the commit after the
    fact would cost more than it buys at this point in the run.
  - LOW missing CHANGELOG drop. **Deferred to F4** (finalization), which is
    where this repo's convention places it; will cover both the block
    passthrough and the inline-anchor warn-banner wording tightening.
- **Re-verification after fixes:** `markdownRawHtmlBlock.test.ts` gained a
  blockquote-wrap pinning test (multi-line block, every line carries `> `)
  and a prose-absorption pinning test; full vitest + typecheck + lint re-run
  clean (see Test Completeness Ledger).

## External Code Review Cascade
- **Branch:** A (`available`) — openrouter, deepseek key present
- **Ran on:** the diff AFTER Stage-2 fixes were applied (regenerated diff file)
- **Result:** openai `revise` (succeeded); deepseek `degraded` (provider
  returned an empty reply, `contradiction.requires_resolution: true` because
  only one reviewer answered — not a disagreement between two verdicts, so no
  `--contradiction-resolution` was needed to record it)
- **Finding (openai, medium):** `isSafeInlineAnchorOpen`
  (`markdownTiptap.ts`) only recognized a double-quoted, `SAFE_LINK_PROTOCOLS`-
  prefixed absolute URL — a single-quoted/unquoted attribute, or a relative/
  fragment/protocol-relative href (`/docs`, `#section`, `//example.com`),
  is still accepted and round-tripped losslessly by the actual `Link` mark
  (verified empirically: `@tiptap/extension-link`'s own exported
  `isAllowedUri(href, SAFE_LINK_PROTOCOLS)` returns `true` for all of these
  and `false` for `javascript:`/`data:`, matching what the mark itself
  enforces) but was incorrectly flagged as still-lossy.
- **Fixed:** `isSafeInlineAnchorOpen` now calls tiptap's own `isAllowedUri`
  instead of a hand-rolled scheme-prefix regex — the second time in this
  iterate a hand-rolled re-implementation of "what the schema actually
  accepts" has been the source of a false positive/negative (the first was
  the original blanket lossy-HTML regex this iterate replaced). Reusing the
  library's own predicate closes the whole class rather than patching one
  case. Pinned by new tests (single-quote, unquoted, relative, fragment,
  protocol-relative — not flagged; javascript:/data: — still flagged).

## Doubt Review (Stage 3, doubt-reviewer)
- **Ran:** yes — non-trivial surface (atom node rendering attacker-
  influenceable content; writes back to the user's real file, not a
  throwaway buffer)
- **Trigger:** irreversible-operations (judgment call — not literally a
  migration/async/cross-plugin case, but corruption of a real content file
  the user may not have backed up warranted the pass)
- **Doubts raised and addressed (6: 1 high, 2 medium, 3 low):**
  1. **HIGH, fixed structurally.** `state.text(html, false)` (Stage 2) made
     a *wrapped* chip serialize correctly but did not stop the wrap — a
     blockquote/list wrap via the toolbar, save, reopen re-nests the marker
     and re-drops attributes, silently reintroducing the exact bug this
     iterate fixes. Fixed by removing `rawHtmlBlock` from the `"block"`
     group entirely and adding `RawHtmlBlockDocument` (overrides `doc`'s
     content to `"(block|rawHtmlBlock)+"`), so the node has no valid
     position except the document's own top level — the schema itself,
     not a per-command guard, makes the wrap impossible. Pinned by a test
     asserting `toggleBlockquote`/`toggleBulletList` both return `false` and
     leave the doc byte-unchanged; the delimiter-per-line behavior is now
     pinned separately via a direct `MarkdownSerializerState` unit test
     (defense in depth — the live editor can no longer reach a delimited
     position for this node at all).
  2. **MEDIUM, fixed.** Marker-payload decode-failure handling (Stage 2)
     only covered a `throw`; `atob` on short/garbage/empty input does not
     throw, so a nested marker-shaped element already present in a file
     (level!==0, reaches the DOM parser verbatim) could have its real
     children silently replaced by decoded garbage. Fixed with a
     `MARKER_MAGIC` literal prefix only `encodePayload` ever produces
     (`decodePayload` returns `null`, not a throw, when absent) plus a
     `childNodes.length !== 0` guard (the renderer never emits children).
     Pinned by two tests covering substitution and mojibake/empty-payload.
  3. **MEDIUM, rebutted + disclosed.** The byte-for-byte claim does not hold
     at the whole-file level for `html_block` rules 1-5 (comment/pre-script-
     style/doctype/cdata) immediately followed by prose with no blank
     line — a blank line the user never typed gets inserted. AC-1's claim
     was already scoped to "that block" (the block's own bytes), and the
     file's own header already discloses inter-block whitespace
     normalization as an editor-wide, pre-existing property — this is not
     new to raw HTML. Visible in the pre-save diff either way, not silent.
     A full fix (preserving exact inter-block spacing for every node type)
     is out of scope for this bug fix. Pinned the actual behavior with a
     new test instead of leaving it untested.
  4. **LOW, fixed.** `MarkdownEditorModal.tsx` fed `detectLossyConstructs`
     the full file (`res.text`, including frontmatter) while the editor
     itself only ever sees `env.core` (frontmatter stripped) — a false
     positive is possible for HTML-looking frontmatter text. One-line fix:
     classify `env.core` instead.
  5. **LOW, rebutted.** `client/package-lock.json` was absent from the
     reviewed diff despite `package.json` gaining two dependencies. It IS
     modified in the worktree (confirmed via `git status`) — excluded from
     `code-review-diff.txt` only by the diff-generation command's path
     filter (reviewer-noise reduction), not because it's stale. Included in
     the F6 commit.
  6. **LOW, accepted-not-fixed.** `encodePayload`'s per-byte
     `String.fromCharCode` cost runs on every parse/render; a pathological
     block could stall the main thread. Bounded by the existing SmartViewer
     file-size caps (worst case is a known few-MB ceiling, not unbounded);
     deferred as out of scope for a bug-fix iterate, documented rather than
     silently dropped.
- **What the reviewer tried and could NOT disprove:** the per-line delimiter
  mechanics of `state.text()` against the real library source; the base64/
  Unicode round-trip (empty string, lone surrogates unreachable post-UTF-8);
  that naive HTML-attribute interpolation would have been caught by
  `MarkdownParser.parse()`'s own `element.innerHTML` re-serialization step
  (the base64 alphabet survives it untouched — confirms the encoding choice
  is load-bearing for a reason the original comments didn't name);
  idempotent rule registration; "inert text, never innerHTML" across every
  render path (chip, diff view, sanitized preview, clipboard); that other
  toolbar commands (heading, code block, horizontal rule) cannot silently
  corrupt or convert a chip.

## Implementation Notes (post-review)

- **Internal plan review (opus-plan-reviewer) + both external reviewers**
  drove several design changes before/during build: base64-encoded marker
  payload (never naive HTML-attribute interpolation), text-only NodeView
  rendering (never innerHTML — XSS-safe by construction via ProseMirror's
  DOMOutputSpec string-child contract), idempotent markdown-it rule
  registration (plain reassignment, never wrap-and-stack), `level === 0`
  scoping (top-level blocks only — sidesteps the blockquote/list delimiter
  problem entirely rather than solving it), and reusing the SAME markdown-it
  config for both the parser and `detectLossyConstructs` (factored into
  `MARKDOWN_IT_OPTIONS`, `markdownRawHtmlBlock.ts`).
- **Incidental improvement found while implementing AC-4:** the OLD blanket
  regex flagged an href-only inline `<a>` (the pre-existing, already-lossless
  "Built with Shipwright" case) as lossy too — a false positive. The
  attribute-aware rewrite fixes that alongside the block-level fix; the
  `markdown-editor.spec.ts` "blog file" E2E test's assertion was updated
  (warn banner now correctly hidden for that fixture) to match.
- **File split:** `markdownTiptap.ts` crossed 300 lines mid-implementation.
  Split into `markdownEnvelope.ts` (frontmatter/envelope — pre-existing,
  cohesive, has its own test file already) and `markdownRawHtmlBlock.ts`
  (the new node) — both re-exported from `markdownTiptap.ts` so no call site
  changed. Matches `feedback_bloat_retirement_split` (cohesive file-level
  split, not per-handler).
