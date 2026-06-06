import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import Home from "../app/page";

const MOCK_INDUSTRIES = ["SaaS / B2B Software", "Finance / Fintech"];

const mockBrandsList = [
  {
    id: 1,
    name: "Acme Cloud",
    domain: "acme.com",
    visibility_pct: 78.5,
    trend: 4.2,
    probe_count: 10,
    last_run: "2026-05-30T12:00:00Z",
    is_example: false,
  },
  {
    id: 2,
    name: "Beta Tech",
    domain: "betatech.io",
    visibility_pct: 45.0,
    trend: -1.5,
    probe_count: 10,
    last_run: "2026-05-30T12:00:00Z",
    is_example: false,
  },
  {
    id: 3,
    name: "Delta System",
    domain: "deltasys.net",
    visibility_pct: null,
    trend: null,
    probe_count: 0,
    last_run: null,
    is_example: false,
  },
];

function mockFetch(brands: typeof mockBrandsList | [] = []) {
  return jest.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.includes("/audit/limit-status")) {
      return Promise.resolve({ ok: true, json: async () => ({ limit_reached: false, count: 0, max: 2 }) });
    }
    if (url.includes("/brands/industries")) {
      return Promise.resolve({ ok: true, json: async () => MOCK_INDUSTRIES });
    }
    if (options?.method === "DELETE") {
      return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
    }
    if (url.includes("/brands/compare")) {
      return Promise.resolve({ ok: true, json: async () => brands });
    }
    return Promise.resolve({ ok: true, json: async () => [] });
  });
}

describe("Homepage Dashboard Component", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("renders onboarding when no audited brands exist", async () => {
    global.fetch = mockFetch([]);
    render(<Home />);
    // During loading the onboarding content is not yet shown (skeleton is up).
    expect(screen.queryByText("How Aura works")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("How Aura works")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Brand name")).toBeInTheDocument();
    expect(screen.queryByText("Anthropic Claude 3.5 Sonnet")).not.toBeInTheDocument();
  });

  it("renders audited and unaudited brands", async () => {
    global.fetch = mockFetch(mockBrandsList);
    render(<Home />);
    await waitFor(() => {
      expect(screen.getAllByText("Acme Cloud").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Unaudited Brands")).toBeInTheDocument();
    expect(screen.getByText("Delta System")).toBeInTheDocument();
  });

  it("filters brand list by search query", async () => {
    global.fetch = mockFetch(mockBrandsList);
    render(<Home />);
    await waitFor(() => expect(screen.getAllByText("Acme Cloud").length).toBeGreaterThan(0));
    const searchInput = screen.getByLabelText("Search brand names");
    fireEvent.change(searchInput, { target: { value: "acme" } });
    expect(screen.getAllByText("Acme Cloud").length).toBeGreaterThan(0);
    expect(screen.queryByText("Beta Tech")).not.toBeInTheDocument();
  });

  it("allows brand creation even when audit limit reached", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/audit/limit-status")) {
        return Promise.resolve({ ok: true, json: async () => ({ limit_reached: true, count: 2, max: 2 }) });
      }
      if (url.includes("/brands/industries")) {
        return Promise.resolve({ ok: true, json: async () => MOCK_INDUSTRIES });
      }
      if (url.includes("/brands/compare")) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    render(<Home />);
    await waitFor(() => expect(screen.getByLabelText("Brand name")).toBeInTheDocument());
    expect(screen.getByLabelText("Brand name")).not.toBeDisabled();
  });
});
