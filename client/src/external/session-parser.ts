import { extractAskUserPayload } from "../lib/askUserPayload";
import { detectStopHook } from "./parsers/stop-hook";

/*
 * POC vertical slice — client-side session JSONL parser.
 *
 * Parses the on-disk ~/.claude/projects/<cwd>/<uuid>.jsonl stream into
 * typed events suitable for read-only rendering. Unknown top-level
 * types fall through to an `unknown` variant so nothing is silently
 * dropped (round-1 GPT BLOCKER on transcript fallback).
 *
 * Observed top-level `type` values in the on-disk format (from PoC
 * fixtures 01/02/03/05): user, assistant, attachment, queue-operation,
 * file-history-snapshot, ai-title, last-prompt. More may surface for
 * plan-mode, slash commands, plugin events — the `unknown` variant
 * catches everything else.
 */

export type ParsedEvent =
  | UserEvent
  | SlashCommandEvent
  | SkillBodyEvent
  | TaskNotificationEvent
  | AssistantEvent
  | AttachmentEvent
  | QueueOpEvent
  | FileSnapshotEvent
  | AiTitleEvent
  | LastPromptEvent
  | SystemEvent
  | CustomTitleEvent
  | AgentNameEvent
  | PermissionModeEvent
  | ModeChangeEvent
  | PrLinkEvent
  | StopHookEvent
  | UnknownEvent;

export interface BaseEvent {
  sessionId?: string;
  timestamp?: string;
  uuid?: string;
}

export interface UserEvent extends BaseEvent {
  kind: "user";
  /** Raw message content as produced by the CLI. Could be string or block array. */
  content: unknown;
}

/**
 * 2026-04-23 — iterate-20260423-chat-rendering-polish.
 * User-type events whose content is EXCLUSIVELY a Claude Code slash-command
 * invocation (e.g. `<command-message>shipwright-compliance:compliance</command-message>`
 * followed by `<command-name>/shipwright-compliance:compliance</command-name>`)
 * are parsed to this kind instead of `user` so the renderer can show a
 * centered command-chip instead of a raw user-bubble containing XML tags.
 * Mixed content (user text plus command tags) falls back to `user`.
 */
export interface SlashCommandEvent extends BaseEvent {
  kind: "slash-command";
  /** The command name, e.g. `/shipwright-compliance:compliance`. */
  commandName: string;
}

/**
 * 2026-04-23 — iterate-20260423-chat-followups AC-3 (ADR-055, refined by
 * iterate-20260423-chat-livetest-2 AC-A / ADR-056).
 *
 * Claude Code injects the full skill manual as a user-role event when a
 * skill is loaded. The content always starts with `Base directory for this
 * skill: <absolute path>` followed by a blank line and a `# <Skill Title>`
 * heading. Parser detects this fingerprint (length-guarded, CRLF-normalized,
 * heading scanned after the preamble) and emits this kind so the renderer
 * can collapse it to a compact card with the Markdown body folded behind
 * a chevron (see `<SkillCard>`).
 *
 * `body` is OPTIONAL for forward-compat — legacy events parsed before
 * AC-A shipped won't have it; the renderer handles missing bodies by
 * hiding the expand chevron.
 */
export interface SkillBodyEvent extends BaseEvent {
  kind: "skill-body";
  /** Title extracted from the first `# <heading>` line after the preamble. */
  skillName: string;
  /** Markdown body from the H1 heading onward (optional — legacy events). */
  body?: string;
}

/**
 * 2026-05-01 — iterate-2026-05-01-task-notification-render.
 *
 * Claude Code v2.1.119+ emits background-task lifecycle as user-role
 * events whose `content` is a `<task-notification>...</task-notification>`
 * XML envelope and `origin.kind === "task-notification"`. Without
 * reclassification these render as a right-aligned user bubble showing
 * the raw XML — the renderer can't distinguish them from a typed message.
 *
 * Detection runs on user-role events only; mixed prose containing a
 * notification block falls back to plain `user` so legitimate user text
 * is never swallowed.
 */
export interface TaskNotificationEvent extends BaseEvent {
  kind: "task-notification";
  /** `completed` | `failed` | `unknown`. Verbatim from `<status>`. */
  status: string;
  /** Verbatim from `<summary>`. May be empty for malformed envelopes. */
  summary: string;
  /** From `<task-id>`. Empty when absent. */
  taskId: string;
}

export interface AssistantEvent extends BaseEvent {
  kind: "assistant";
  /** Raw content array: text blocks, tool_use blocks, thinking, etc. */
  content: unknown;
}

export interface AttachmentEvent extends BaseEvent {
  kind: "attachment";
  /** Raw attachment payload. */
  attachment: unknown;
}

export interface QueueOpEvent extends BaseEvent {
  kind: "queue-operation";
  operation: string;
  detail?: unknown;
}

export interface FileSnapshotEvent extends BaseEvent {
  kind: "file-history-snapshot";
  snapshot: unknown;
  isSnapshotUpdate?: boolean;
}

export interface AiTitleEvent extends BaseEvent {
  kind: "ai-title";
  title: string;
}

export interface LastPromptEvent extends BaseEvent {
  kind: "last-prompt";
  prompt: unknown;
}

export interface SystemEvent extends BaseEvent {
  kind: "system";
  text: string;
  subtype?: string;
}

export interface CustomTitleEvent extends BaseEvent {
  kind: "custom-title";
  title: string;
}

export interface AgentNameEvent extends BaseEvent {
  kind: "agent-name";
  name: string;
}

export interface PermissionModeEvent extends BaseEvent {
  kind: "permission-mode";
  mode: string;
}

/**
 * 2026-05-27 — iterate-2026-05-27-transcript-renderer-scroll AC1.
 *
 * Claude Code emits a `type: "mode"` heartbeat (~30× per session) with
 * `mode: string` ("normal" by default). Before this iterate it fell
 * through to `kind:"unknown"` and rendered as a yellow warning card,
 * repeated 30× — pure noise. Now rendered as a sky/lavender pill,
 * grouped under `SYSTEM_KINDS` so the toolbar's "show system" toggle
 * hides it by default (matches `permission-mode` semantics).
 *
 * Defensive: emitted only when `raw.mode` is a non-empty string.
 * Any other shape (object, missing, empty) falls through to
 * `kind:"unknown"` so a future schema drift can't crash the renderer
 * with "Objects are not valid as a React child".
 */
export interface ModeChangeEvent extends BaseEvent {
  kind: "mode-change";
  mode: string;
}

/**
 * 2026-05-27 — iterate-2026-05-27-transcript-renderer-scroll AC2.
 *
 * Claude Code emits `type: "pr-link"` when a PR URL becomes visible
 * during the session, carrying `prNumber: number`, `prUrl: string`,
 * `prRepository: string`. Before this iterate it fell through to
 * `kind:"unknown"` and rendered as a yellow warning card.
 *
 * Defensive: emitted only when ALL of:
 *   (i)  `prNumber` is `Number.isFinite()`,
 *   (ii) `prUrl` is a non-empty string matching `^https?://`,
 *   (iii) `prRepository` is a non-empty string.
 * The scheme check is an XSS guard — JSONL is an io-boundary from a
 * third-party producer; an unvalidated `javascript:` or `data:` URL
 * rendered into an `<a href>` would bypass `noopener noreferrer`.
 */
export interface PrLinkEvent extends BaseEvent {
  kind: "pr-link";
  prNumber: number;
  prUrl: string;
  prRepository: string;
}

/**
 * 2026-05-27 — iterate-2026-05-27-transcript-renderer-scroll AC3.
 *
 * Claude Code injects Stop-hook output as a user-role event whose
 * `content` is a plain string starting with `"Stop hook feedback:\n=...
 * \n  SHIPWRIGHT <GATE> ...\n=...\n<body>"`. Before this iterate it
 * rendered as a right-aligned user bubble showing the full ASCII-art
 * banner — visually identical to a real user message. Now reclassified
 * by content fingerprint (see `parsers/stop-hook.ts`) so the renderer
 * can show a collapsed Tool-call-style card with the gate name in the
 * header and the body folded behind a chevron.
 *
 * String-only — all 12/12 observed events in the sample session carry
 * string content. If Claude ever ships array-block content for stop
 * hooks, the detector returns null and the event falls through to
 * plain `user` (no swallowing).
 */
export interface StopHookEvent extends BaseEvent {
  kind: "stop-hook";
  /** Banner title (e.g. "SHIPWRIGHT BLOAT GATE"); "Stop hook" when malformed. */
  gateName: string;
  /** Full raw content for the expanded view. */
  body: string;
}

export interface UnknownEvent extends BaseEvent {
  kind: "unknown";
  /** Original top-level `type` string, if any. */
  originalType: string;
  /** Untouched raw event JSON for debugging / expand-to-raw rendering. */
  raw: Record<string, unknown>;
}

export interface ParseResult {
  events: ParsedEvent[];
  /** Lines that failed JSON.parse — typically the trailing partial line. */
  malformedLines: number;
}

export function parseSessionJsonl(content: string): ParseResult {
  if (!content) return { events: [], malformedLines: 0 };
  const lines = content.split("\n");
  const events: ParsedEvent[] = [];
  let malformed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Last line of an actively-written file may be a torn read (the
      // newline hasn't been flushed yet). Silently swallow that case.
      // Middle-line parse failures point at real malformation or schema
      // drift — emit an unknown stub with the raw text so the UI can
      // show "skipped: bad JSON" instead of dropping silently.
      malformed++;
      const isLastLine = i === lines.length - 1;
      if (!isLastLine) {
        events.push({
          kind: "unknown",
          originalType: "(unparseable)",
          raw: { __rawLine: line.length > 500 ? `${line.slice(0, 500)}…` : line },
        });
      }
      continue;
    }
    events.push(parseOne(raw));
  }
  return { events, malformedLines: malformed };
}

function parseOne(raw: Record<string, unknown>): ParsedEvent {
  const base: BaseEvent = {
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
    uuid: typeof raw.uuid === "string" ? raw.uuid : undefined,
  };
  const type = typeof raw.type === "string" ? raw.type : "";
  switch (type) {
    case "user": {
      const content = (raw.message as { content?: unknown } | undefined)?.content ?? raw.message;
      // 2026-04-23 — strict slash-command detection. Only reclassify if the
      // content is a string that matches BOTH tags back-to-back with only
      // whitespace around them — mixed user text falls through to `user`.
      const slash = detectSlashCommand(content);
      if (slash) {
        return { ...base, kind: "slash-command", commandName: slash };
      }
      // 2026-04-23 — iterate-20260423-chat-followups AC-3 / ADR-056 AC-A:
      // skill-loader fingerprint. Length-guarded + CRLF-normalized +
      // heading-after-preamble. Body captured so `<SkillCard>` can
      // Markdown-render it on expand. Mutually exclusive with slash-command.
      const skill = extractSkillBody(content);
      if (skill) {
        return {
          ...base,
          kind: "skill-body",
          skillName: skill.skillName,
          body: skill.body,
        };
      }
      // 2026-05-01 — task-notification reclassification (see
      // TaskNotificationEvent doc). Detected via content envelope first,
      // origin.kind as a secondary sanity check (older Claude builds may
      // omit origin). Mixed prose falls through to plain `user`.
      const notification = extractTaskNotification(content);
      if (notification) {
        return { ...base, kind: "task-notification", ...notification };
      }
      // 2026-05-27 — iterate-2026-05-27-transcript-renderer-scroll AC3:
      // Stop-hook fingerprint (string-start `"Stop hook feedback:"`).
      // Runs LAST among the user-content reclassifiers — most specific
      // first. Mixed prose falls through to plain `user`.
      const stopHook = detectStopHook(content);
      if (stopHook) {
        return { ...base, kind: "stop-hook", ...stopHook };
      }
      return { ...base, kind: "user", content };
    }
    case "assistant":
      return {
        ...base,
        kind: "assistant",
        content: (raw.message as { content?: unknown } | undefined)?.content ?? raw.message,
      };
    case "attachment":
      return { ...base, kind: "attachment", attachment: raw.attachment };
    case "queue-operation":
      return {
        ...base,
        kind: "queue-operation",
        operation: typeof raw.operation === "string" ? raw.operation : "unknown",
        detail: raw.content,
      };
    case "file-history-snapshot":
      return {
        ...base,
        kind: "file-history-snapshot",
        snapshot: raw.snapshot,
        isSnapshotUpdate: Boolean(raw.isSnapshotUpdate),
      };
    case "ai-title":
      return {
        ...base,
        kind: "ai-title",
        title:
          typeof (raw as { title?: unknown }).title === "string"
            ? ((raw as { title: string }).title)
            : "",
      };
    case "last-prompt":
      return { ...base, kind: "last-prompt", prompt: raw.prompt };
    case "system": {
      const content = typeof raw.content === "string" ? raw.content : "";
      const text =
        content ||
        (typeof (raw as { text?: unknown }).text === "string"
          ? ((raw as { text: string }).text)
          : "");
      return {
        ...base,
        kind: "system",
        text,
        subtype: typeof raw.subtype === "string" ? raw.subtype : undefined,
      };
    }
    case "custom-title": {
      const title =
        typeof (raw as { customTitle?: unknown }).customTitle === "string"
          ? ((raw as { customTitle: string }).customTitle)
          : typeof (raw as { title?: unknown }).title === "string"
          ? ((raw as { title: string }).title)
          : "";
      return { ...base, kind: "custom-title", title };
    }
    case "agent-name": {
      const name =
        typeof (raw as { agentName?: unknown }).agentName === "string"
          ? ((raw as { agentName: string }).agentName)
          : typeof (raw as { name?: unknown }).name === "string"
          ? ((raw as { name: string }).name)
          : "";
      return { ...base, kind: "agent-name", name };
    }
    case "permission-mode": {
      const mode =
        typeof (raw as { permissionMode?: unknown }).permissionMode === "string"
          ? ((raw as { permissionMode: string }).permissionMode)
          : typeof (raw as { mode?: unknown }).mode === "string"
          ? ((raw as { mode: string }).mode)
          : "";
      return { ...base, kind: "permission-mode", mode };
    }
    case "mode": {
      // 2026-05-27 AC1 — defensive: only string mode-values become
      // mode-change events. Object/missing/empty falls through to
      // `unknown` so we never pass a non-primitive into React.
      const modeValue = (raw as { mode?: unknown }).mode;
      if (typeof modeValue !== "string" || modeValue.length === 0) {
        return { ...base, kind: "unknown", originalType: type, raw };
      }
      return { ...base, kind: "mode-change", mode: modeValue };
    }
    case "pr-link": {
      // 2026-05-27 AC2 — defensive: scheme-validated href + finite
      // prNumber + non-empty repo. JSONL is a third-party producer;
      // an unvalidated href would be an XSS vector. Any failed check
      // falls through to `unknown`.
      const prNumber = (raw as { prNumber?: unknown }).prNumber;
      const prUrl = (raw as { prUrl?: unknown }).prUrl;
      const prRepository = (raw as { prRepository?: unknown }).prRepository;
      if (
        typeof prNumber === "number" &&
        Number.isFinite(prNumber) &&
        typeof prUrl === "string" &&
        /^https?:\/\//.test(prUrl) &&
        typeof prRepository === "string" &&
        prRepository.length > 0
      ) {
        return { ...base, kind: "pr-link", prNumber, prUrl, prRepository };
      }
      return { ...base, kind: "unknown", originalType: type, raw };
    }
    default:
      return { ...base, kind: "unknown", originalType: type || "(no-type)", raw };
  }
}

/** Collapses an assistant event's content array into plain text for a minimal viewer. */
export function assistantText(e: AssistantEvent): string {
  const content = e.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("\n");
}

/** Extracts user message text. User content can be string OR array OR object with content. */
export function userText(e: UserEvent): string {
  const c = e.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (const block of c) {
      if (block && typeof block === "object") {
        const b = block as { type?: unknown; text?: unknown; content?: unknown };
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
        else if (b.type === "tool_result" && typeof b.content === "string") parts.push(`[tool_result] ${b.content}`);
      }
    }
    return parts.join("\n");
  }
  if (c && typeof c === "object") {
    const obj = c as { content?: unknown };
    if (typeof obj.content === "string") return obj.content;
  }
  return "";
}

/** Extracts tool_use blocks from an assistant event for a minimal tool-card list. */
export function toolUses(e: AssistantEvent): Array<{ id: string; name: string; input: unknown }> {
  const content = e.content;
  if (!Array.isArray(content)) return [];
  const out: Array<{ id: string; name: string; input: unknown }> = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
      if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
        out.push({ id: b.id, name: b.name, input: b.input });
      }
    }
  }
  return out;
}

/**
 * Safe getter for AskUserQuestion's first question + options. Delegates to
 * `extractAskUserPayload` so we accept every schema the real CLI emits —
 * the nested `questions: [{ question, header, options: [{ label, ... }], multiSelect }]`
 * form as well as the legacy flat `{ question, options }` form — and returns
 * the first question's summary. Falls back to a generic placeholder when no
 * readable question can be recovered.
 */
export function askUserQuestionSummary(input: unknown): {
  question: string;
  options: string[];
  fallback: boolean;
} {
  const { parts } = extractAskUserPayload(input);
  const first = parts[0];
  if (!first || !first.question.trim()) {
    return { question: "Question format unreadable", options: [], fallback: true };
  }
  return {
    question: first.question,
    options: first.options ?? [],
    fallback: false,
  };
}

/** Extracts tool_result blocks from a user event (Claude reports tool
 * outputs as user-role events with `tool_result` content blocks). */
export function toolResults(
  e: UserEvent,
): Array<{ tool_use_id: string; content: string; is_error: boolean }> {
  const c = e.content;
  if (!Array.isArray(c)) return [];
  const out: Array<{ tool_use_id: string; content: string; is_error: boolean }> = [];
  for (const block of c) {
    if (block && typeof block === "object") {
      const b = block as {
        type?: unknown;
        tool_use_id?: unknown;
        content?: unknown;
        is_error?: unknown;
      };
      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const content = typeof b.content === "string"
          ? b.content
          : Array.isArray(b.content)
          ? collectTextBlocks(b.content)
          : "";
        out.push({
          tool_use_id: b.tool_use_id,
          content,
          is_error: Boolean(b.is_error),
        });
      }
    }
  }
  return out;
}

function collectTextBlocks(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block && typeof block === "object") {
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("\n");
}

// ── 2026-04-23 — iterate-20260423-chat-rendering-polish helpers ──

/**
 * Strict slash-command detector. Returns the command name (without the
 * leading `/`) when `content` is EXCLUSIVELY a Claude Code slash-command
 * invocation — paired `<command-message>NAME</command-message>` +
 * `<command-name>/NAME</command-name>` tags with only whitespace allowed
 * around and between them. Returns null for mixed content.
 *
 * Required shape (whitespace-permissive):
 *   <command-message>NAME</command-message>\s*<command-name>/NAME</command-name>
 *
 * Mixed-content guard prevents swallowing a normal user message that
 * happens to contain `<command-message>` as literal text.
 */
function detectSlashCommand(content: unknown): string | null {
  if (typeof content !== "string") return null;
  // Length cap — a legitimate slash command name is ~50 chars tops.
  // Anything over ~200 is almost certainly user prose that happened
  // to contain command-tag shapes.
  if (content.length > 200) return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith("<command-message>") || !trimmed.endsWith("</command-name>")) {
    return null;
  }
  // `[^<\n]+` (no newlines inside tags) narrows the match so a real
  // user message whose text contains a newline + balanced tag strings
  // can't match. Length-bounded further by the 200-char guard above.
  const pattern =
    /^<command-message>([^<\n]+)<\/command-message>\s*<command-name>\/([^<\n]+)<\/command-name>$/;
  const match = trimmed.match(pattern);
  if (!match) return null;
  const [, inner, named] = match;
  // Names must match (Claude Code always emits them paired). If they
  // differ, the content is hand-crafted and should render as plain user.
  if (inner.trim() !== named.trim()) return null;
  return `/${named.trim()}`;
}

/**
 * Unwrap user-message content into a single text string for fingerprint
 * detection. Claude JSONL emits user content in two shapes:
 *   (a) Plain string — e.g. slash-command invocations, typed messages.
 *   (b) Array of blocks `[{type: "text", text: "..."}, ...]` — e.g.
 *       skill-loader injections from Claude Code's CLI.
 *
 * Returns the string directly for (a), or the concatenated text from
 * all text blocks for (b). Returns null when no readable text can be
 * recovered (tool_result-only content, non-string / non-array shapes).
 */
function normalizeUserTextContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  if (parts.length === 0) return null;
  return parts.join("\n");
}

/**
 * 2026-04-23 — iterate-20260423-chat-followups AC-3 (parser fingerprint)
 * extended by iterate-20260423-chat-livetest-2 AC-A / ADR-056 (capture
 * the body so `<SkillCard>` can markdown-render it on expand).
 *
 * Claude Code's skill-loader injects the full skill manual as a user-role
 * message. Shape: `Base directory for this skill: <absolute path>` line,
 * blank line, then the manual starting with `# <Skill Title>`. Some
 * manuals include a short preamble blurb before the H1 heading.
 *
 * Detection is conservative:
 *   - content must be a string (arrays fall through)
 *   - length >= 100 chars (short messages like "Base directory for this
 *     skill: /x\n\n# Hi" stay user — real manuals run thousands of chars)
 *   - CRLF line endings normalized to LF before match
 *   - must start with the literal fingerprint (case-sensitive)
 *   - the first `# <heading>` line ANYWHERE after the first blank line is
 *     the skill name; leading/trailing whitespace stripped.
 *   - `body` = content from the H1 line onward (keeps the heading IN the
 *     body so Markdown rendering treats it as the doc title).
 *
 * Returns `{skillName, body}` on match, null otherwise. Mixed content
 * (user message that happens to contain the phrase mid-body) does not
 * match because startsWith is anchored.
 */
export function extractSkillBody(
  content: unknown,
): { skillName: string; body: string } | null {
  // 2026-04-23 — post-ship bug fix. Real Claude JSONL emits user-role
  // content as an array `[{type: "text", text: "..."}]` for skill-loader
  // injections (while slash-commands stay string). Earlier tests used
  // string-content and missed this asymmetry. Unwrap single text block
  // before running the fingerprint.
  const text = normalizeUserTextContent(content);
  if (text == null) return null;
  if (text.length < 100) return null;
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("Base directory for this skill:")) return null;

  // Scan forward past the preamble (first blank line) for the first
  // top-level `# <heading>` (H1 only — `## Sub-heading` before the H1
  // would be a false positive). Allow leading whitespace on the heading.
  const lines = normalized.split("\n");
  let pastPreamble = false;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!pastPreamble) {
      if (rawLine.trim() === "") pastPreamble = true;
      continue;
    }
    const trimmed = rawLine.trim();
    // H1 = `#` followed by whitespace (not `##`, `###`, etc.).
    if (!/^#\s+/.test(trimmed)) continue;
    const skillName = trimmed.replace(/^#\s+/, "").trim();
    if (skillName.length === 0) continue;
    // Body = from this H1 line onward (use the raw line, not trimmed,
    // so leading whitespace on subsequent lines is preserved for code
    // blocks etc.). `.slice(i)` keeps the H1 as the body's first line.
    const body = lines.slice(i).join("\n").trim();
    return { skillName, body };
  }
  return null;
}

/**
 * 2026-05-01 — iterate-2026-05-01-task-notification-render.
 *
 * Detects a Claude Code background-task lifecycle envelope. Returns the
 * parsed fields when content is EXCLUSIVELY a `<task-notification>...
 * </task-notification>` block (only whitespace allowed around it).
 * Mixed user prose containing the envelope mid-text returns null so a
 * legitimate user message is never swallowed.
 *
 * Tag parsing is lenient on order and missing fields:
 *   - `<status>` → status; defaults to "unknown" when absent.
 *   - `<summary>` → summary; defaults to "" when absent.
 *   - `<task-id>` → taskId; defaults to "" when absent.
 *
 * Length cap (4 KB) prevents pathological inputs from running the regex
 * over megabyte-scale strings; real envelopes observed in the wild are
 * a few hundred bytes.
 */
export function extractTaskNotification(
  content: unknown,
): { status: string; summary: string; taskId: string } | null {
  if (typeof content !== "string") return null;
  if (content.length > 4096) return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith("<task-notification>")) return null;
  if (!trimmed.endsWith("</task-notification>")) return null;
  const status = readSingleTag(trimmed, "status") ?? "unknown";
  const summary = readSingleTag(trimmed, "summary") ?? "";
  const taskId = readSingleTag(trimmed, "task-id") ?? "";
  return { status, summary, taskId };
}

function readSingleTag(source: string, tag: string): string | null {
  // Match the FIRST occurrence of `<tag>...</tag>`. Inner content cannot
  // span another `<` so deliberately-nested envelopes don't bleed across.
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = source.indexOf(open);
  if (start < 0) return null;
  const valueStart = start + open.length;
  const end = source.indexOf(close, valueStart);
  if (end < 0) return null;
  return source.slice(valueStart, end).trim();
}

/**
 * Extract basename filenames from a `file-history-snapshot` event. Walks
 * `snapshot.trackedFileBackups` keys, returns an array of basenames
 * (path segments stripped — avoids leaking full user filesystem paths
 * into the UI). Empty array when no files are tracked.
 */
export function fileSnapshotBasenames(e: FileSnapshotEvent): string[] {
  const s = e.snapshot;
  if (!s || typeof s !== "object") return [];
  const backups = (s as { trackedFileBackups?: unknown }).trackedFileBackups;
  if (!backups || typeof backups !== "object") return [];
  const out: string[] = [];
  for (const key of Object.keys(backups)) {
    const basename = basenameOf(key);
    if (basename) out.push(basename);
  }
  return out;
}

/** Cross-platform basename: strips everything before the last `/` or `\`. */
function basenameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * 2026-04-23 — iterate-20260423-chat-followups AC-1.
 * True iff the user event's content is an array of ONLY tool_result
 * blocks (no text, no other block types). Used by the renderer to
 * decide whether the separate tool_result bubble can be suppressed
 * once the output is folded into the matching ToolCard. Mixed content
 * (tool_result + text) returns false so the bubble continues to render
 * and no data is silently dropped.
 */
export function isOnlyToolResults(e: UserEvent): boolean {
  const c = e.content;
  if (!Array.isArray(c) || c.length === 0) return false;
  for (const block of c) {
    if (!block || typeof block !== "object") return false;
    const b = block as { type?: unknown };
    if (b.type !== "tool_result") return false;
  }
  return true;
}

/**
 * AC-5 — detect whether an assistant event has non-empty TEXT content
 * that deserves its own bubble shell (border + CLAUDE header + body).
 * Tool-use blocks render as sibling ToolCards OUTSIDE the bubble; they
 * do NOT cause the bubble shell to appear. Consequently a tool-only
 * assistant turn renders tool cards with no speech bubble above —
 * which is the fix for the user-reported "empty Claude message with
 * just an avatar" defect.
 *
 * True when: at least one text block contains non-whitespace text, or
 * (legacy) the content is a non-empty string. False for thinking-only,
 * tool-only, or empty-string/whitespace-only turns.
 */
export function hasVisibleBubbleContent(e: AssistantEvent): boolean {
  const content = e.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * AC-5 — true iff the assistant event contains ONLY thinking blocks
 * (no text, no tool_use, no other block types with visible output).
 * Used to render a thinking-card instead of suppressing the bubble.
 */
export function isThinkingOnly(e: AssistantEvent): boolean {
  const content = e.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  let sawThinking = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown };
    if (b.type === "thinking") {
      sawThinking = true;
      continue;
    }
    // Any non-thinking block disqualifies the "thinking-only" classification.
    return false;
  }
  return sawThinking;
}
