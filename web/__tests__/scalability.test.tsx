import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import Home from "../app/page";

function mockFetch(brands: object[]) {
  return jest.fn().mockImplementation((url: string) => {
    if (url.includes("/audit/limit-status")) {
      return Promise.resolve({ ok: true, json: async () => ({ limit_reached: false, count: 0, max: 2 }) });
    }
    if (url.includes("/brands/industries")) {
      return Promise.resolve({ ok: true, json: async () => ["SaaS / B2B Software"] });
    }
    if (url.includes("/brands/compare")) {
      return Promise.resolve({ ok: true, json: async () => brands });
    }
    return Promise.resolve({ ok: true, json: async () => [] });
  });
}

describe("Dashboard scalability", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("renders 60 brands and filters by search", async () => {
    const brands = Array.from({ length: 60 }, (_, i) => {
      const id = i + 1;
      const audited = id <= 40;
      return {
        id,
        name: `Brand Scale ${id}`,
        domain: `brandscale${id}.example`,
        visibility_pct: audited ? 30 + (id % 50) : null,
        trend: audited ? 1.5 : null,
        probe_count: audited ? 10 : 0,
        last_run: audited ? "2026-05-30T12:00:00Z" : null,
        is_example: false,
      };
    });

    global.fetch = mockFetch(brands);
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("Brands Tracked")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Brand Scale 10").length).toBeGreaterThan(0);
    expect(screen.getByText("Brand Scale 50")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search brand names"), { target: { value: "Brand Scale 55" } });
    expect(screen.getByText("Brand Scale 55")).toBeInTheDocument();
    expect(screen.queryByText("Brand Scale 10")).not.toBeInTheDocument();
  });
});
