import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import Home from "../app/page";

describe("Dashboard High-Density Load Scalability Tests", () => {
  let originalFetch: typeof global.fetch;

  // Generate 60 mock brand items (40 audited with varying scores, 20 pending/unaudited)
  const generateMockBrands = (count: number) => {
    const brands = [];
    for (let i = 1; i <= count; i++) {
      const isAudited = i <= 40;
      brands.push({
        id: i,
        name: `Brand Scale ${i}`,
        domain: `brandscale${i}.com`,
        visibility_pct: isAudited ? (i % 2 === 0 ? 30 + (i % 50) : 50 + (i % 45)) : null,
        trend: isAudited ? (i % 3 === 0 ? 1.5 : -0.8) : null,
        probe_count: isAudited ? 10 : 0,
        last_run: isAudited ? "2026-05-30T12:00:00Z" : null,
      });
    }
    return brands;
  };

  beforeEach(() => {
    originalFetch = global.fetch;
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("handles high-density datasets (50+ brands) efficiently without crashing", async () => {
    const mockBrands = generateMockBrands(60);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockBrands,
    });
    global.fetch = fetchMock;

    const startTime = performance.now();

    await act(async () => {
      render(<Home />);
    });

    // Wait for data load and render completion
    await waitFor(() => {
      expect(screen.queryByText("Loading brands database...")).not.toBeInTheDocument();
    });

    const endTime = performance.now();
    const renderTime = endTime - startTime;

    // Check that rendering large datasets is highly efficient (e.g. well under Jest standard timeout boundary)
    expect(renderTime).toBeLessThan(5000);

    // Verify stats summarize correct values
    // Tracked count should render correctly
    expect(screen.getByText("Brands Tracked")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();

    // Verify list holds elements from both lists
    // Check that at least a few random high index items are rendered
    expect(screen.getAllByText("Brand Scale 10").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Brand Scale 40").length).toBeGreaterThan(0);
    expect(screen.getByText("Brand Scale 50")).toBeInTheDocument(); // Unaudited (in sidebar, rendered once)
    expect(screen.getByText("Brand Scale 60")).toBeInTheDocument(); // Unaudited (in sidebar, rendered once)

    // Verify search filtering works instantly with 60 items
    const searchInput = screen.getByLabelText("Search brand names");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "Brand Scale 55" } });
    });

    // Only Brand Scale 55 should be in the DOM
    expect(screen.getByText("Brand Scale 55")).toBeInTheDocument();
    expect(screen.queryByText("Brand Scale 10")).not.toBeInTheDocument();
    expect(screen.queryByText("Brand Scale 40")).not.toBeInTheDocument();
  });
});
