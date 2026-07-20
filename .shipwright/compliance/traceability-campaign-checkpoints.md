# Traceability — coordination checkpoints (monorepo requirements-catalog campaign)

> **Why this file exists.** The monorepo *requirements-catalog* campaign changes
> how the traceability **manifest** (`test-traceability.json`) and the **RTM**
> (`traceability-matrix.md`) are produced. The campaign's own artifacts live in
> the **monorepo**, so nothing on the webui side would otherwise remember the two
> checks that must happen *here* as that campaign lands. They are recorded as
> checkpoints — **not defects** — because they are blocked on external merges and
> must be done at a specific moment, not now.
>
> Reference: the monorepo campaign spec **§7.1** carries the measured impact table
> for all five changes; four of them cost this repo nothing.

Filed by `iterate-2026-07-20-traceability-schema-version-guard` (FR-01.66). The
same iterate delivered the two **hardening** items (schema-version guard + its
test); those are done and are described at the bottom.

---

## CP-1 — after the campaign's **namespace step** merges: regenerate manifest + RTM

**Do:** regenerate this repo's traceability manifest and RTM.

**Why then:** the namespace step is the point at which the manifest **key form
becomes final**. The composite outer key of `requirements` changes from a
**directory-derived** form (`01-adopted::FR-01.66`) to an **id-derived** one.

**Expected result:** the regenerated `test-traceability.json` shows a
**whole-file diff**. That is **expected, not a defect** — every key string moves.

**Why behaviour here is unaffected:** the reader
(`server/src/core/mission-context/traceability.ts`, `readTraceabilityIndex`)
**never reads the composite outer key**. It iterates `Object.values(requirements)`
and consumes the inner `.id` (and `.tests`). Confirmed at filing time:

```
for (const req of Object.values(requirements ...)) {   // values, not keys
  const frId = ... r.id ...                             // inner id
```

**How to verify after regen (no product-code change should be needed):**

```bash
cd server && npx vitest run src/core/mission-context/traceability.test.ts
```

The REAL-repo calibration probe (`inverts this repo's own generated manifest into
a non-empty file index`) must stay green and every `byFile` key must still look
like a file path (never a `file::test name` id). If the manifest also bumps
`schema_version`, see CP-3 below — an ahead-of-us version is *warned*, not fatal.

---

## CP-2 — after the campaign's **catalog-merge step** merges: click one RTM deep link

**Do:** open the regenerated RTM (`traceability-matrix.md`), click **one**
requirement deep link, and confirm it scrolls to the **matching heading**.

**Why:** the failure mode is **silent**. If heading anchors are generated from
slugs but the links use a shorter form, a broken link scrolls **nowhere** and
reports **nothing**. The catalog-merge step is required to emit **explicit
anchors**; this manual click is the check that it actually did.

**State at filing time:** the current RTM has **no** requirement deep links or
per-requirement headings yet — only `<a id="evt-…">` event anchors and a Coverage
Summary. The requirement links + headings arrive **with** the catalog-merge step,
so this check is not runnable before it lands.

**Pass criterion:** the clicked link lands on the correct requirement heading (not
the top of the page, not "nowhere").

---

## CP-3 (hardening — DONE in this iterate): schema-version guard on the reader

Independent of the campaign, surfaced by the same review:

1. **The reader did not consult the contract-version helper.** A `schema_version`
   bump on the manifest passed unremarked — neither refused nor warned.
   **Fixed:** `readTraceabilityIndex` now calls `checkContractVersion(...)` with a
   new `TRACEABILITY_SCHEMA_VERSION` constant (in `server/src/core/contract-version.ts`).
   An ahead-of-us version logs **one** `contract_version_ahead` warning and the
   read proceeds — matching that helper's documented fail-soft policy (an older
   observer must not lock a user out of a newer project).

2. **Schema-regression coverage.** The review noted the reader had "no test file."
   It in fact already had `traceability.test.ts`, but with **no schema-version
   test** — because the behaviour did not exist. That coverage now lives in
   `server/src/core/mission-context/traceability.schema-version.test.ts`: a
   version-ahead manifest warns *and* still inverts to a valid index; equal and
   absent versions stay silent.
