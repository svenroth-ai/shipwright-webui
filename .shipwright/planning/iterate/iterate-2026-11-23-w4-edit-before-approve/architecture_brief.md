# Architecture brief - W4 edit before approving

Question: how does a local single-user web UI let the operator rewrite a lead's proposed learning before approving it, so that only the rewritten line lands in the decisions log and nothing the lead quoted from a chat does?

Options:
- A. Countersign takes an optional line; the server rebuilds the log block from the proposed line only (no fence, no quotes) and the audit records "edited" or "approved as proposed" plus a structured pointer to the observation.
- B. Keep copying the whole entry block to the log and strip quotes afterwards with a separate cleanup pass.
- C. Let the operator edit the proposed file by hand; no edit support in the window.
- D. A client-side edit that sends a "this was edited" flag; the server trusts it.

Constraints: the leadwright daemon also writes the proposed file; the WebUI changes it only through the locked countersign path; the audit and the log must never hold quote text or the original wording of an edited line; old (unfenced) entries must keep working; the line/quote rule must exist once and be drift-guarded across server and client.
