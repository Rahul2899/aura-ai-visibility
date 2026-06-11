import React from "react";
import { render, screen } from "@testing-library/react";
import ComparisonChart from "../app/components/ComparisonChart";

describe("ComparisonChart Component", () => {
  const sampleBrands = [
    { id: 1, name: "Brand C", visibility_pct: 20 },
    { id: 2, name: "Brand A", visibility_pct: 80 },
    { id: 3, name: "Brand B", visibility_pct: 50 },
    { id: 4, name: "Brand D", visibility_pct: null }, // shouldn't render
  ];

  it("renders one row per brand with visibility data, sorted descending", () => {
    render(<ComparisonChart brands={sampleBrands} />);
    const rows = screen.getAllByTestId("comparison-row");
    expect(rows).toHaveLength(3); // Brand D (null) excluded
    // Names appear in descending-visibility order: A(80), B(50), C(20)
    const names = rows.map(r => r.querySelector("[data-testid='comparison-name']")?.textContent);
    expect(names).toEqual(["Brand A", "Brand B", "Brand C"]);
  });

  it("renders each bar fill width proportional to the score (real DOM, not a mock)", () => {
    render(<ComparisonChart brands={sampleBrands} />);
    const fills = screen.getAllByTestId("comparison-fill");
    // Brand A is 80% -> the fill style carries width:80%. This is the regression guard:
    // the old recharts bars rendered at width 0 (invisible).
    expect(fills[0].style.width).toBe("80%");
    expect(fills[1].style.width).toBe("50%");
    expect(fills[2].style.width).toBe("20%");
  });

  it("shows the percentage label for each brand", () => {
    render(<ComparisonChart brands={sampleBrands} />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("keeps a 0% bar visible as a sliver (never width 0)", () => {
    render(<ComparisonChart brands={[{ id: 1, name: "Zero", visibility_pct: 0 }]} />);
    const fill = screen.getByTestId("comparison-fill");
    // minimum visible sliver so the "0%" reads as a real bar, not a missing one
    expect(fill.style.width).toBe("2%");
  });

  it("returns null if no brands have visibility data", () => {
    const { container } = render(<ComparisonChart brands={[{ id: 1, name: "X", visibility_pct: null }]} />);
    expect(container.firstChild).toBeNull();
  });
});
