/*
 * orgLearningLabel.ts — reads the label of a learning proposal's line, exactly as leadwright reads it back from the
 * countersigned line (iterate-2026-11-28-decision-record-evidence). Port of leadwright #153 `lib/learning-proposal.ts`
 * (`parseLearningLabel`, `isLearningKey`) and `lib/decision-key-form.ts` (the `replaces` key rule); the problem texts are
 * leadwright's own, so the window warns in the words the lead's audit trail would use (`learning_not_promoted`).
 *
 *     Learning (this lead, importance 4, pinned): <rule>
 *     Learning (all leads, importance 3, replaces learning.weekly-digest): <rule>
 *
 * The reach comes first, then `importance N`, `pinned`, `replaces <key>`, each at most once, in any order. A line with
 * no label reads as "this lead, importance 3"; a label that is present but outside this grammar is unreadable and the
 * daemon will not write that learning (it never guesses). Display only: nothing here changes what is countersigned.
 */

export const LEARNING_KEY_PREFIX = "learning.";
export const DEFAULT_LEARNING_IMPORTANCE = 3;

export interface LearningLabel {
  scope: "lead" | "all";
  importance: number;
  pinned: boolean;
  replaces: string | undefined;
  /** The rule: the line after the label. */
  rule: string;
}

export type ParsedLearningLine = { ok: true; label: LearningLabel; labelled: boolean } | { ok: false; problem: string };

const LABEL_START_RE = /^learning \(/i;
const LABEL_RE = /^learning \(([^()]*)\):[ \t]+(\S.*)$/i;
// leadwright WEBUI_DECISION_KEY_RE, applied to the encoded key (lib/decision-key-form.ts)
const KEY_FORM_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export const normalizeDecisionKey = (key: string): string => key.trim().toLowerCase();

export function isLearningKey(normalizedKey: string): boolean {
  return normalizedKey.startsWith(LEARNING_KEY_PREFIX) && normalizedKey.length > LEARNING_KEY_PREFIX.length;
}

function keyFormOk(normalizedKey: string): boolean {
  try {
    return KEY_FORM_RE.test(encodeURIComponent(normalizedKey));
  } catch {
    return false;
  }
}

/** Reads the label of a (possibly operator-edited) line. */
export function parseLearningLabel(line: string): ParsedLearningLine {
  const text = line.trim();
  if (!LABEL_START_RE.test(text)) return { ok: true, labelled: false, label: { scope: "lead", importance: DEFAULT_LEARNING_IMPORTANCE, pinned: false, replaces: undefined, rule: text } };
  const m = LABEL_RE.exec(text);
  if (m === null) return { ok: false, problem: "the line starts with 'Learning (' but the label is not closed by '):' followed by the rule" };
  const parts = m[1].split(",").map((p) => p.trim().toLowerCase().replace(/\s+/g, " "));
  const reach = parts.shift();
  if (reach !== "this lead" && reach !== "all leads") return { ok: false, problem: "the label must start with 'this lead' or 'all leads'" };
  const label: LearningLabel = { scope: reach === "all leads" ? "all" : "lead", importance: DEFAULT_LEARNING_IMPORTANCE, pinned: false, replaces: undefined, rule: m[2].trim() };
  const seen = new Set<string>();
  for (const part of parts) {
    const name = part.split(" ")[0];
    if (seen.has(name)) return { ok: false, problem: `the label names '${name}' twice` };
    seen.add(name);
    let v: RegExpExecArray | null;
    if ((v = /^importance ([1-5])$/.exec(part))) label.importance = Number(v[1]);
    else if (part === "pinned") label.pinned = true;
    else if ((v = /^replaces (\S+)$/.exec(part)) && isLearningKey(v[1]) && keyFormOk(v[1])) label.replaces = v[1];
    else return { ok: false, problem: "the label holds a part other than 'importance 1' to 'importance 5', 'pinned' or 'replaces learning.<key>'" };
  }
  return { ok: true, labelled: true, label };
}
