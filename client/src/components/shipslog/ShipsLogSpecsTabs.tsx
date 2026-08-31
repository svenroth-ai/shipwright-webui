/*
 * ShipsLogSpecsTabs — the Specs group of the Ship's-Log Documents panel
 * (iterate-2026-08-31-shipslog-documents-panel), two Radix tabs:
 *   Requirements — the per-planning-section ur-spec(s)
 *                  (.shipwright/planning/<section>/spec.md)
 *   Iterate      — the flat *.md mini-specs under
 *                  .shipwright/planning/iterate/, client-filterable
 *
 * Deliberately two SEPARATE tabs, not one merged list (Sven, design
 * approval round 4→5): they answer different questions — "what did we
 * commit to" vs. "what changed, run by run" — and the Iterate list is two
 * orders of magnitude larger (~230 files vs. 1 today), so merging them
 * would bury the Requirements row under search noise.
 *
 * @covers FR-01.60
 */

import { useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";

import { ShipsLogDocList } from "./ShipsLogDocList";
import type { ShipsLogDocRow } from "../../lib/shipsLogDocsApi";

interface Props {
  requirements: ShipsLogDocRow[];
  iterateSpecs: ShipsLogDocRow[];
  onOpen: (path: string) => void;
}

export function ShipsLogSpecsTabs({ requirements, iterateSpecs, onOpen }: Props) {
  const [query, setQuery] = useState("");

  const filteredIterate = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return iterateSpecs;
    return iterateSpecs.filter((row) => row.label.toLowerCase().includes(q));
  }, [iterateSpecs, query]);

  return (
    <Tabs.Root defaultValue="requirements" data-testid="shipslog-specs-tabs">
      <Tabs.List className="doc-tabs-list" aria-label="Specs">
        <Tabs.Trigger
          value="requirements"
          className="doc-tab"
          data-testid="shipslog-specs-tab-requirements"
        >
          Requirements
        </Tabs.Trigger>
        <Tabs.Trigger value="iterate" className="doc-tab" data-testid="shipslog-specs-tab-iterate">
          Iterate
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="requirements" data-testid="shipslog-specs-panel-requirements">
        <div className="doc-list-scroll">
          <ShipsLogDocList
            rows={requirements}
            emptyLabel="No requirements spec found yet."
            onOpen={onOpen}
          />
        </div>
      </Tabs.Content>

      <Tabs.Content value="iterate" data-testid="shipslog-specs-panel-iterate">
        <div className="doc-search-wrap">
          <label htmlFor="shipslog-iterate-search" className="sr-only">
            Search iterate specs
          </label>
          <input
            id="shipslog-iterate-search"
            type="search"
            className="doc-search"
            placeholder="Search iterate specs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="shipslog-iterate-search"
          />
        </div>
        <div className="doc-list-scroll">
          <ShipsLogDocList
            rows={filteredIterate}
            emptyLabel={query ? "No matching iterate specs." : "No iterate specs yet."}
            onOpen={onOpen}
          />
        </div>
      </Tabs.Content>
    </Tabs.Root>
  );
}
