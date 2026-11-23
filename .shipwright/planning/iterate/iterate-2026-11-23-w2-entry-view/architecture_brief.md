# Architecture brief: W2 structured entry view

Problem: the operator window shows a proposed entry as sanitised markdown plus one raw evidence line; the operator cannot tell quotes from the proposed line or see which source each quote came from.

Options:
1. Keep the markdown rendering and only restyle it.
2. Derive a small read-only display model from the entry's raw block in the client (separate module + component) and render structured elements as plain text.
3. Extend the shared entry parser (client mirror and server) to return quotes and pointers as fields.
4. Do nothing (the operator reads the raw block).

Permanent additions of the chosen change: one pure client module and one component; no new route, no stored data, no server change.
