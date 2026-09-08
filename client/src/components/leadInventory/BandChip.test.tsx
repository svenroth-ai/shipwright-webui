import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BandChip } from "./BandChip";

describe("BandChip", () => {
  it("renders the same label for the same band regardless of variant (structural 'same words')", () => {
    const { rerender } = render(<BandChip band="bugfix" />);
    expect(screen.getByTestId("band-chip-bugfix")).toHaveTextContent("Bugfix");
    rerender(<BandChip band="bugfix" variant="declared" />);
    expect(screen.getByTestId("band-chip-bugfix")).toHaveTextContent("Bugfix");
  });

  it("renders all 4 canonical bands with distinct labels", () => {
    render(
      <>
        <BandChip band="bugfix" />
        <BandChip band="maintenance" />
        <BandChip band="feature" />
        <BandChip band="architecture" />
      </>,
    );
    expect(screen.getByTestId("band-chip-bugfix")).toHaveTextContent("Bugfix");
    expect(screen.getByTestId("band-chip-maintenance")).toHaveTextContent("Maintenance");
    expect(screen.getByTestId("band-chip-feature")).toHaveTextContent("Feature");
    expect(screen.getByTestId("band-chip-architecture")).toHaveTextContent("Architecture");
  });
});
