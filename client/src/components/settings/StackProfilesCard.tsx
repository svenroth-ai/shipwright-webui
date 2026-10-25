/*
 * Stack profiles card (Settings). Lists the stack profiles Shipwright can use —
 * the project's own, your personal ones, and the built-in ones — with where
 * each came from and whether it is valid, lets you re-check one, and creates a
 * personal/project copy of a built-in profile to edit. Everything shown is the
 * monorepo resolver's verdict (`/api/stack-profiles`); the card never decides
 * validity or lookup order itself.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useStackProfiles } from "../../hooks/useStackProfiles";
import {
  SOURCE_LABEL,
  createStackProfile,
  validateStackProfile,
  type StackProfileEntry,
  type StackProfileSource,
} from "../../lib/stackProfilesApi";

const SECTION_ORDER: StackProfileSource[] = ["project", "user", "bundled"];
const NAME_HINT = "Lowercase letters, digits and dashes, e.g. my-stack";

type Check = { state: "ok" } | { state: "bad"; error: string };

export function StackProfilesCard({ projects }: { projects: Array<{ id: string; name: string }> }) {
  const [projectId, setProjectId] = useState<string>("");
  const query = useStackProfiles(projectId || null);
  const qc = useQueryClient();
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [from, setFrom] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const outcome = query.data;
  const profiles: StackProfileEntry[] = outcome?.status === "ok" ? outcome.report.profiles : [];
  const bundled = profiles.filter((p) => p.source === "bundled" && p.valid);
  const effectiveFrom = from || bundled[0]?.name || "";
  const canCreate = !busy && effectiveFrom !== "" && name.trim() !== "" && (scope === "user" || projectId !== "");

  async function check(p: StackProfileEntry) {
    const r = await validateStackProfile(p.name, projectId || null);
    const next: Check =
      r.status === "ok" ? (r.report.valid ? { state: "ok" } : { state: "bad", error: r.report.error }) : { state: "bad", error: "The resolver isn't available." };
    setChecks((c) => ({ ...c, [`${p.source}:${p.name}`]: next }));
  }

  async function create() {
    setBusy(true);
    setMessage(null);
    const r = await createStackProfile({ from: effectiveFrom, name: name.trim(), scope, projectId: projectId || null });
    setBusy(false);
    if (r.status === "created") {
      setMessage({ tone: "ok", text: `Created “${r.name}”. Edit ${r.path} to make it yours.` });
      setName("");
      await qc.invalidateQueries({ queryKey: ["stack-profiles"] });
    } else {
      setMessage({ tone: "bad", text: r.reason });
    }
  }

  const muted = { fontSize: "13px", color: "var(--color-muted)" } as const;
  const field = {
    fontSize: "14px", padding: "6px 8px", color: "var(--color-text)", background: "var(--color-bg)",
    border: "1px solid var(--color-border)", borderRadius: "var(--radius-input, 6px)",
  } as const;

  return (
    <section
      className="flex flex-col gap-3"
      style={{
        background: "var(--color-surface)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-sm)", padding: "20px",
      }}
      data-testid="settings-stack-profiles"
    >
      <h2 className="font-semibold" style={{ fontSize: "15px", color: "var(--color-text)", margin: 0 }}>
        Stack profiles
      </h2>
      <p style={{ ...muted, margin: 0 }}>
        A stack profile tells Shipwright how your app is built and run. Keep your own in{" "}
        <code>~/.shipwright/profiles/</code> (all projects) or <code>.shipwright/profiles/</code> in a project — they
        survive Shipwright updates.
      </p>

      <label className="flex flex-col gap-1" style={muted}>
        Also show profiles of project
        <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setChecks({}); }} style={{ ...field, alignSelf: "flex-start", minWidth: "220px" }} data-testid="stack-profiles-project">
          <option value="">None (yours and built-in only)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      {query.isLoading ? <p style={muted}>Loading profiles…</p> : null}
      {outcome && outcome.status !== "ok" ? (
        <p role="alert" data-testid="stack-profiles-unavailable" style={{ ...muted, color: "var(--color-danger, #b3261e)" }}>
          {outcome.status === "engine-unavailable"
            ? `${outcome.reason} Run ${outcome.repairCommand} to install it.`
            : outcome.status === "unsupported-contract"
              ? `This Shipwright is newer than this Command Center understands (profile contract ${outcome.version}). Update the Command Center.`
              : outcome.reason}
        </p>
      ) : null}
      {outcome?.status === "ok" && outcome.report.warnings.length > 0 ? (
        <ul style={{ ...muted, margin: 0, paddingLeft: "18px" }} data-testid="stack-profiles-warnings">
          {outcome.report.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}

      {SECTION_ORDER.map((source) => {
        const rows = profiles.filter((p) => p.source === source);
        if (rows.length === 0) return null;
        return (
          <div key={source} data-testid={`stack-profiles-group-${source}`}>
            <h3 className="font-medium" style={{ fontSize: "13px", color: "var(--color-text)", margin: "4px 0" }}>{SOURCE_LABEL[source]}</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
              {rows.map((p) => {
                const result = checks[`${p.source}:${p.name}`];
                return (
                  <li key={`${p.source}:${p.name}`} data-testid={`stack-profile-${p.name}`} className="flex flex-wrap items-center gap-2" style={{ fontSize: "14px" }}>
                    <strong>{p.name}</strong>
                    {!p.valid ? <span data-testid={`stack-profile-invalid-${p.name}`} style={{ color: "var(--color-danger, #b3261e)" }}>⚠ Not usable: {p.error}</span> : <span style={muted}>{p.description ?? ""}</span>}
                    {result ? <span style={{ ...muted, color: result.state === "ok" ? "var(--color-success, #1a7f37)" : "var(--color-danger, #b3261e)" }}>{result.state === "ok" ? "✓ Valid" : `✗ ${result.error}`}</span> : null}
                    <button type="button" onClick={() => void check(p)} data-testid={`stack-profile-check-${p.name}`} style={{ ...field, padding: "2px 8px", fontSize: "12px", marginLeft: "auto" }}>Check</button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <div className="flex flex-col gap-2" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "12px" }} data-testid="stack-profiles-create">
        <h3 className="font-medium" style={{ fontSize: "13px", margin: 0, color: "var(--color-text)" }}>Make your own from a built-in profile</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1" style={muted}>Start from
            <select value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} style={field} data-testid="stack-profiles-from">
              {bundled.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1" style={muted}>New name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-stack" title={NAME_HINT} style={field} data-testid="stack-profiles-name" />
          </label>
          <label className="flex flex-col gap-1" style={muted}>Save for
            <select value={scope} onChange={(e) => setScope(e.target.value as "user" | "project")} style={field} data-testid="stack-profiles-scope">
              <option value="user">All my projects</option>
              <option value="project" disabled={projectId === ""}>The project chosen above</option>
            </select>
          </label>
          <button type="button" disabled={!canCreate} onClick={() => void create()} data-testid="stack-profiles-create-btn" style={{ ...field, opacity: canCreate ? 1 : 0.5 }}>Create</button>
        </div>
        <span style={muted}>{NAME_HINT}</span>
        {message ? <span role="status" data-testid="stack-profiles-message" style={{ ...muted, color: message.tone === "ok" ? "var(--color-success, #1a7f37)" : "var(--color-danger, #b3261e)" }}>{message.text}</span> : null}
      </div>
    </section>
  );
}
