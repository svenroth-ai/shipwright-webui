"""Pure predicate + evaluation logic for FR layer promotion (P0b's w5, S10).

Campaign req3-06-mechanics-webui, sub-iterate w5 — "Bind AC to test and promote
Layers per FR where coverage is green". Mirrors the RULE the shipwright
monorepo's own (not-yet-built) p3.5 unit documents at
``.shipwright/planning/iterate/campaigns/req3-04c-ac-identity-wave2/sub-iterates/
p3.5-promote-layers-per-fr.md``: promotion is per-requirement, one-way, and
autonomous wherever a DECIDABLE predicate holds. Only an undecidable case hands
back to an operator.

**The predicate, made decidable.** An FR's ``Layers`` cell in ``spec.md`` starts
as the bare ``(inferred)`` marker (form convergence, w2) — ``required_layers``
empty, ``required_layers_source: inferred_legacy``. Promotion sets that cell to
an explicit, marker-free layer list once EVERY currently-bound, enabled test
across EVERY layer this FR has observed coverage at is confirmed **green**
against FRESH execution evidence (a vitest JSON report run just now, not a
stale claim) — not just the highest layer, because promoting
``required_layers=[unit, e2e]`` while a bound UNIT test is red would misrepresent
the very obligation the cell now asserts.

**The three escalation cases** (verbatim from the referenced monorepo doc,
adapted to what this repo's manifest can actually show):

1. ``no_observable_layer`` — the FR has NO bound, enabled test at any layer at
   all, so there is no "highest observable layer" to promote to.
2. ``absent_ci_evidence`` — a bound test's id has no evidence entry, or its
   evidence is ``not_run`` — "the named test did not run in the CI evidence at
   all (absent != green)". A test that ran and genuinely FAILED is a different,
   DECIDABLE case (``skip_not_green``, not an escalation): the predicate simply
   does not hold yet, and no operator judgement is needed to see that.
3. ``contradicts_ledger`` — promoting would contradict an existing recorded
   DEMOTION of the same FR in the one-way ledger.

**One-way, never a sweep.** ``required_layers_source == "explicit"`` is a
terminal state for this script: it is never re-evaluated, never demoted. Each
FR is decided independently — there is no batch/sweep flag anywhere in this
module.

**Deliberately STRICTER than the referenced doc's literal wording** (external
plan review, GLM #5): the p3.5 doc's predicate text is "the binding includes
the highest observable layer, and those tests ran green" — read literally,
promoting while a LOWER bound layer is red would still satisfy it. This
module requires every observed layer green, not just the highest, because the
alternative would let a promoted ``required_layers=[unit, e2e]`` cell assert
unit coverage while the actual bound unit test is failing. This is a
sanctioned strengthening for THIS repo's predicate, not a silent deviation.

**The escalation contract is the ``diff_risk_recheck.py`` exit-code SHAPE
(0/continue, non-zero/handback), not a literal call into that CI-supplychain
script** (external plan review, GLM #3 — this was the original task
instruction: reuse the pattern, not the script, since its detectors do not
apply to this domain). The ack-file trust boundary this shape implies is
CONVENTION-enforced, not cryptographic (GLM #8): the fingerprint an operator
must ack is itself published, readable, alongside the ack path, exactly as
``diff_risk_recheck.py``'s own CI-supplychain ack works — the guarantee is
"the run's code never contains a code path that WRITES the ack", not "an
adversary cannot forge one", identical to that reference design.
"""

from __future__ import annotations

from typing import Any

from layer_promotion_ledger import apply_promotion_to_row_cells, ledger_record
from layer_promotion_report import systemic_pattern

LAYER_RANK: dict[str, int] = {"unit": 0, "integration": 1, "e2e": 2}

ESCALATE_NO_OBSERVABLE_LAYER = "no_observable_layer"
ESCALATE_ABSENT_CI_EVIDENCE = "absent_ci_evidence"
ESCALATE_CONTRADICTS_LEDGER = "contradicts_ledger"

ACTION_PROMOTE = "promote"
ACTION_SKIP_ALREADY_EXPLICIT = "skip_already_explicit"
ACTION_SKIP_NOT_GREEN = "skip_not_green"
ACTION_SKIP_REMOVED = "skip_removed"
ACTION_ESCALATE = "escalate"


def observed_layers(tests_by_layer: dict[str, Any] | None) -> list[str]:
    """Layers with at least one ``enabled`` test bound, sorted by ``LAYER_RANK``."""
    tests_by_layer = tests_by_layer or {}
    present = [
        layer
        for layer, tests in tests_by_layer.items()
        if layer in LAYER_RANK
        and any(isinstance(t, dict) and t.get("status") == "enabled" for t in (tests or []))
    ]
    return sorted(present, key=lambda layer: LAYER_RANK[layer])


def _unknown_layer_names(tests_by_layer: dict[str, Any] | None) -> list[str]:
    """Layer keys this manifest carries bindings under that this script does not
    recognize (outside ``LAYER_RANK``) — external plan review (GLM #9a): a
    typo'd or future layer name (``"perf"``, ``"component"``) would otherwise be
    silently invisible, surfacing only as an unexplained ``no_observable_layer``.
    Named here so the escalation detail can call it out explicitly."""
    tests_by_layer = tests_by_layer or {}
    return sorted(layer for layer in tests_by_layer if layer not in LAYER_RANK)


def _bound_enabled_tests(tests_by_layer: dict[str, Any], layers: list[str]) -> list[dict]:
    out: list[dict] = []
    for layer in layers:
        for t in tests_by_layer.get(layer) or []:
            if isinstance(t, dict) and t.get("status") == "enabled" and t.get("id"):
                out.append({"id": t["id"], "layer": layer})
    return out


def evaluate_requirement(
    fr_id: str,
    requirement: dict[str, Any],
    evidence: dict[str, Any],
    ledger: dict[str, Any],
) -> dict[str, Any]:
    """Decide ONE requirement's promotion action. Never mutates its arguments."""
    if requirement.get("status") == "removed":
        return {"fr_id": fr_id, "action": ACTION_SKIP_REMOVED, "reason_code": None}

    if requirement.get("required_layers_source") == "explicit":
        return {"fr_id": fr_id, "action": ACTION_SKIP_ALREADY_EXPLICIT, "reason_code": None}

    ledger_entry = ledger.get(fr_id)
    if isinstance(ledger_entry, dict) and ledger_entry.get("status") == "demoted":
        return {
            "fr_id": fr_id,
            "action": ACTION_ESCALATE,
            "reason_code": ESCALATE_CONTRADICTS_LEDGER,
            "detail": f"ledger records a prior demotion of {fr_id}; promoting now would contradict it",
        }

    tests_by_layer = requirement.get("tests") or {}
    layers = observed_layers(tests_by_layer)
    if not layers:
        unknown = _unknown_layer_names(tests_by_layer)
        detail = f"{fr_id} has no bound, enabled test at any layer in the manifest"
        if unknown:
            detail += f" (unrecognized layer name(s) present and ignored: {', '.join(unknown)})"
        return {
            "fr_id": fr_id,
            "action": ACTION_ESCALATE,
            "reason_code": ESCALATE_NO_OBSERVABLE_LAYER,
            "detail": detail,
            "unknown_layer_names": unknown,
        }

    bound = _bound_enabled_tests(tests_by_layer, layers)
    if not bound:
        # Code review (orchestrator, high): without this guard an enabled
        # binding with no usable id falls through to ACTION_PROMOTE with
        # evidence_test_ids=[] -- a zero-evidence promotion in a one-way
        # mechanism. Escalate instead.
        return {
            "fr_id": fr_id,
            "action": ACTION_ESCALATE,
            "reason_code": ESCALATE_NO_OBSERVABLE_LAYER,
            "detail": f"{fr_id} has an enabled binding under {', '.join(layers)} but none carries a usable test id",
            "unknown_layer_names": [],
        }
    missing = [
        t["id"] for t in bound
        if t["id"] not in evidence
        or not isinstance(evidence[t["id"]], dict)
        or evidence[t["id"]].get("executed") not in ("pass", "fail")
    ]
    if missing:
        # Two DISTINCT root causes hide under one reason_code, both fail-closed
        # for the same reason (never guess a join): (a) a layer this run fed NO
        # evidence for at all (e.g. e2e, when only vitest reports were supplied
        # — the common/expected case), vs (b) a template-literal test title
        # (`test.each`'s `${term}` interpolated at RUNTIME) whose STATIC
        # manifest id keeps the unresolved placeholder, so it can never join a
        # vitest JSON report's rendered title — a known limitation of the
        # shared evidence-reader's vitest parser (it strips pytest's `[p0]`
        # parametrization suffix but has no equivalent for JS template
        # literals). Labelled for the operator, NOT auto-resolved: guessing a
        # join here is exactly the false-pass risk this whole mechanism exists
        # to prevent.
        likely_join_gap = [tid for tid in missing if "${" in tid]
        return {
            "fr_id": fr_id,
            "action": ACTION_ESCALATE,
            "reason_code": ESCALATE_ABSENT_CI_EVIDENCE,
            "detail": (
                f"{len(missing)} of {len(bound)} bound test(s) for {fr_id} have no fresh "
                "execution evidence (absent != green)"
            ),
            "missing_test_ids": missing,
            "likely_parameterized_title_join_gap": likely_join_gap,
        }

    failing = [t["id"] for t in bound if evidence[t["id"]]["executed"] == "fail"]
    if failing:
        return {
            "fr_id": fr_id,
            "action": ACTION_SKIP_NOT_GREEN,
            "reason_code": None,
            "failing_test_ids": failing,
        }

    return {
        "fr_id": fr_id,
        "action": ACTION_PROMOTE,
        "reason_code": None,
        "layers": layers,
        "evidence_test_ids": [t["id"] for t in bound],
    }


def evaluate_manifest(
    requirements: dict[str, Any],
    evidence: dict[str, Any],
    ledger: dict[str, Any],
) -> dict[str, Any]:
    """Evaluate every requirement in a manifest's ``requirements`` map.

    ``requirements`` is keyed ``namespace::FR-ID`` (manifest v3/v4 shape); the
    returned decisions are keyed by the bare FR id (``requirement["id"]``),
    which is what the ledger and the spec.md row-lookup use.
    """
    promotions: list[dict] = []
    skipped: list[dict] = []
    escalations: list[dict] = []
    removed_fr_ids: list[str] = []
    evaluated = 0

    for key, req in requirements.items():
        if not isinstance(req, dict) or not req.get("id"):
            continue
        fr_id = req["id"]
        decision = evaluate_requirement(fr_id, req, evidence, ledger)
        decision["manifest_key"] = key
        if decision["action"] == ACTION_SKIP_REMOVED:
            # External plan review (GLM #9b): a removed FR must still be
            # NAMED in the run's own report, not merely dropped — otherwise
            # it is invisible to an operator reading the output.
            removed_fr_ids.append(fr_id)
            continue
        evaluated += 1
        if decision["action"] == ACTION_PROMOTE:
            promotions.append(decision)
        elif decision["action"] == ACTION_ESCALATE:
            escalations.append(decision)
        else:
            skipped.append(decision)

    return {
        "promotions": promotions,
        "skipped": skipped,
        "escalations": escalations,
        "total_evaluated": evaluated,
        "removed_fr_ids": sorted(removed_fr_ids),
    }


__all__ = [
    "LAYER_RANK",
    "ESCALATE_NO_OBSERVABLE_LAYER",
    "ESCALATE_ABSENT_CI_EVIDENCE",
    "ESCALATE_CONTRADICTS_LEDGER",
    "ACTION_PROMOTE",
    "ACTION_SKIP_ALREADY_EXPLICIT",
    "ACTION_SKIP_NOT_GREEN",
    "ACTION_SKIP_REMOVED",
    "ACTION_ESCALATE",
    "observed_layers",
    "evaluate_requirement",
    "evaluate_manifest",
    "systemic_pattern",
    "apply_promotion_to_row_cells",
    "ledger_record",
]
