# S4 — honest lifecycle stage ("Where it stands" from the iterate's REAL phase)

## Problem
`inferStage` (client/src/lib/narrator-transcript.ts) was furthest-along-wins over
COARSE tool signals: the first Edit/Write to any non-spec file set `build = true`,
and Build outranks Analyze. The "Where it stands" stepper therefore left Analyze
while the iterate was still scouting/calibrating.

## Empirical basis (READ-ONLY probe over ~/.claude/projects, 114 real iterate transcripts)
- 17/114 (15%) had a scratch/bookkeeping write as their FIRST edit, ahead of every
  strong marker -> mis-read as Build during Analyze. This is the bug.
- TodoWrite (the brief's stated PRIMARY signal) appears in only 10/114 (9%), and
  its task text is free-form campaign unit lists, not phase vocabulary.
  Keyword-matching a stage from that free text would FABRICATE a phase.
- Markers that ARE real: gh pr 93%, setup_iterate_worktree 89%, finalize_iterate
  85%, spec/planning write 68%, classify_complexity 66%.

## Design
1. New `stage-markers.ts`: ONE authority `classifyEditPath` ->
   spec | finalize | incidental | product. `collectMarkers` flattens a transcript
   window into a marker set.
2. New `stage-derivation.ts`: `deriveStage(events, {scenario, phase})`.
   - iterate/campaign -> furthest-along over REAL markers; an INCIDENTAL edit
     (scratch/plan/todo/.shipwright/memory) never contributes Build, so Analyze
     holds through scope. A PRODUCT edit still advances (it is real build work).
   - pipeline -> the authoritative run-config phase, mapped to the 6 labels.
     An unreadable phase -> honest null, NEVER a fallback to the tool guess.
   - plain (positively resolved, no kickoff evidence) -> coarse activity read,
     stage suppressed: a plain session has no lifecycle to be positioned in.
   - UNRESOLVED scenario (null) is deliberately NOT treated as plain: "don't
     know" must not collapse into a positive finding.
3. `inferStage`/`summarizeTranscript` delegate (no mirrored second implementation).
4. `currentIterateEvents` windowing PRESERVED unchanged.
5. `pipelinePhase(context)` in missionArtifacts.ts keeps phase strings out of
   components (DO-NOT #11). MissionBody threads scenario+phase into useMissionLive.
6. MissionLeftPanel renders the coarse activity in the existing none-slot.

## Constraints honoured
Pure client-side (no server change). No writes to ~/.claude/projects. Stateless
reads. No second write surface. Files <=300 LOC (both source and test split).
Terminal zero-diff. Extends FR-01.66; mints no new FR.

## Risks
- Behaviour change for PLAIN sessions: they no longer claim a lifecycle stage.
  This is S4 AC5, and it supersedes one shipped E2E assertion (updated deliberately).
- Sticky-Analyze could over-hold. Falsified empirically: over 564 samples from 188
  real transcripts, only 23 changed, ALL Build->Analyze/Spec, and the
  Merge/Test/Finalize distributions are byte-identical (nothing sticks).
