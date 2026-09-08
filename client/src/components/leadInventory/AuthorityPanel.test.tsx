import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthorityPanel } from "./AuthorityPanel";
import type { AuthorityPanelView } from "../../lib/leadInventoryApi";

describe("AuthorityPanel", () => {
  it("renders per-band prose and a completeness line for all 4 declared bands, never 'may act alone'", () => {
    const authority: AuthorityPanelView = {
      measured: true,
      declaredCount: 4,
      bands: [
        { id: "bugfix", name: "Bugfix / bekannter Defekt", declared: true, text: "Fix small defects." },
        { id: "maintenance", name: "Kleine Pflege", declared: true, text: "Routine upkeep." },
        { id: "feature", name: "Neues Feature", declared: true, text: "Ask first." },
        { id: "architecture", name: "Architektur / Grundsatz", declared: true, text: "Ask first." },
      ],
    };
    render(<AuthorityPanel authority={authority} />);
    const panel = screen.getByTestId("authority-panel");
    expect(panel.textContent).not.toMatch(/may act alone/i);
    expect(panel.textContent).toContain("Fix small defects.");
    expect(screen.getByTestId("authority-panel-completeness")).toHaveTextContent("4/4 declared");
  });

  it("marks a missing band with the muted 'not declared' variant and copy", () => {
    const authority: AuthorityPanelView = {
      measured: true,
      declaredCount: 3,
      bands: [
        { id: "bugfix", name: "Bugfix / bekannter Defekt", declared: true, text: "Fix small defects." },
        { id: "maintenance", name: "Kleine Pflege", declared: true, text: "Routine upkeep." },
        { id: "feature", name: "Neues Feature", declared: false, text: null },
        { id: "architecture", name: "Architektur / Grundsatz", declared: true, text: "Ask first." },
      ],
    };
    render(<AuthorityPanel authority={authority} />);
    expect(screen.getByTestId("authority-panel-completeness")).toHaveTextContent("3/4 declared");
    expect(screen.getByTestId("band-chip-feature")).toBeInTheDocument();
    expect(screen.getByTestId("authority-panel").textContent).toContain("Not declared in this lead's charter");
  });

  it("renders an honest degrade reason when the charter could not be measured", () => {
    render(<AuthorityPanel authority={{ measured: false, reason: "custom charter path not yet supported by this panel" }} />);
    expect(screen.getByTestId("authority-panel-not-measured")).toHaveTextContent(
      "custom charter path not yet supported by this panel",
    );
  });
});
