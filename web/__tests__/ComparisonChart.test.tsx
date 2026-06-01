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

  it("renders brands sorted by visibility percentage descending", () => {
    const { container } = render(<ComparisonChart brands={sampleBrands} />);

    const barChart = screen.getByTestId("bar-chart");
    expect(barChart).toBeInTheDocument();

    const dataAttr = barChart.getAttribute("data-data");
    expect(dataAttr).toBeTruthy();

    const parsedData = JSON.parse(dataAttr || "[]");
    expect(parsedData).toHaveLength(3);
    // Sort verification
    expect(parsedData[0].name).toBe("Brand A");
    expect(parsedData[0].pct).toBe(80);
    expect(parsedData[1].name).toBe("Brand B");
    expect(parsedData[1].pct).toBe(50);
    expect(parsedData[2].name).toBe("Brand C");
    expect(parsedData[2].pct).toBe(20);
  });

  it("should return null if no brands have visibility data", () => {
    const { container } = render(<ComparisonChart brands={[{ id: 1, name: "X", visibility_pct: null }]} />);
    expect(container.firstChild).toBeNull();
  });
});
