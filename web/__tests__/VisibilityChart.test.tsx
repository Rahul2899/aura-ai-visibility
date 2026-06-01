import React from "react";
import { render, screen } from "@testing-library/react";
import VisibilityChart from "../app/brands/[id]/VisibilityChart";

describe("VisibilityChart Component", () => {
  const sampleData = [
    { label: "May 28", visibility: 30 },
    { label: "May 29", visibility: 55 },
    { label: "May 30", visibility: 70 },
  ];

  it("renders chart container and maps coordinates correctly", () => {
    render(<VisibilityChart data={sampleData} />);

    const areaChart = screen.getByTestId("area-chart");
    expect(areaChart).toBeInTheDocument();

    const dataAttr = areaChart.getAttribute("data-data");
    expect(dataAttr).toBeTruthy();

    const parsedData = JSON.parse(dataAttr || "[]");
    expect(parsedData).toHaveLength(3);
    expect(parsedData[0].label).toBe("May 28");
    expect(parsedData[0].visibility).toBe(30);
    expect(parsedData[2].label).toBe("May 30");
    expect(parsedData[2].visibility).toBe(70);
  });
});
