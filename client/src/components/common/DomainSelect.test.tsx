import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DomainSelect } from "./DomainSelect";

describe("DomainSelect", () => {
  it("lists selectable (kebab-case) domains with unclaimed counts", () => {
    render(
      <DomainSelect
        value=""
        onChange={vi.fn()}
        domains={["billing", "growth"]}
        unclaimedCounts={{ billing: 3 }}
      />,
    );
    const select = screen.getByTestId("domain-select") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("billing (3 unclaimed)");
    expect(options).toContain("growth");
  });

  it("selecting an existing domain calls onChange with it", () => {
    const onChange = vi.fn();
    render(<DomainSelect value="" onChange={onChange} domains={["billing"]} />);
    fireEvent.change(screen.getByTestId("domain-select"), { target: { value: "billing" } });
    expect(onChange).toHaveBeenCalledWith("billing");
  });

  it("a legacy non-kebab-case domain is shown but not selectable", () => {
    render(<DomainSelect value="" onChange={vi.fn()} domains={["Legacy Domain"]} />);
    const select = screen.getByTestId("domain-select") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain("Legacy Domain");
    expect(screen.getByTestId("domain-select-legacy-note").textContent).toContain("Legacy Domain");
  });

  it('"+ create a new domain" opens the create input; confirm is disabled until kebab-case-valid', () => {
    const onChange = vi.fn();
    render(<DomainSelect value="" onChange={onChange} domains={[]} />);
    fireEvent.change(screen.getByTestId("domain-select"), { target: { value: "__create_new__" } });

    const input = screen.getByTestId("domain-select-create-input");
    const confirm = screen.getByTestId("domain-select-create-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Not Valid!" } });
    expect(confirm.disabled).toBe(true);
    expect(screen.getByTestId("domain-select-create-invalid")).toBeTruthy();

    fireEvent.change(input, { target: { value: "new-domain" } });
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    expect(onChange).toHaveBeenCalledWith("new-domain");
  });

  it("degrades to a plain free-text input when unavailable, never a select with no options", () => {
    const onChange = vi.fn();
    render(<DomainSelect value="" onChange={onChange} domains={[]} unavailable />);
    expect(screen.queryByTestId("domain-select")).toBeNull();
    const input = screen.getByTestId("domain-select-unavailable-input");
    fireEvent.change(input, { target: { value: "anything-typed" } });
    expect(onChange).toHaveBeenCalledWith("anything-typed");
  });

  it("cancel returns to the select without calling onChange", () => {
    const onChange = vi.fn();
    render(<DomainSelect value="" onChange={onChange} domains={[]} />);
    fireEvent.change(screen.getByTestId("domain-select"), { target: { value: "__create_new__" } });
    fireEvent.click(screen.getByTestId("domain-select-create-cancel"));
    expect(screen.getByTestId("domain-select")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
