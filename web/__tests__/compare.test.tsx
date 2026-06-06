import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import ComparePage from "../app/compare/page";

describe("Multi-Brand Comparison Page Component", () => {
  let originalFetch: typeof global.fetch;

  const mockBrandOptions = [
    { id: 10, name: "Alpha App", visibility_pct: 82 },
    { id: 20, name: "Beta App", visibility_pct: null },
    { id: 30, name: "Gamma App", visibility_pct: 42 },
  ];

  function createFetchMock() {
    let alphaPollCount = 0;
    return jest.fn().mockImplementation((url: string, options?: any) => {
      // 1. Mount options load
      if (url.includes("/brands/compare")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockBrandOptions,
        });
      }

      // 2. Add brand option (POST)
      if (url.endsWith("/brands") && options?.method === "POST") {
        const body = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 40, name: body.name }),
        });
      }

      // 3. Trigger audits (POST)
      if (url.includes("/audit/brands/10")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ job_id: "job_alpha" }),
        });
      }
      if (url.includes("/audit/brands/30")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ job_id: "job_gamma" }),
        });
      }

      // 4. Poll jobs (GET)
      if (url.includes("/audit/job_alpha")) {
        alphaPollCount++;
        if (alphaPollCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ status: "running", probe_count: 4 }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: "completed", probe_count: 10, visibility_pct: 60 }),
        });
      }
      if (url.includes("/audit/job_gamma")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: "completed", probe_count: 10, visibility_pct: 90 }),
        });
      }

      // 5. Insights list
      if (url.includes("/brands/10/insights")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              visibility_pct: 60,
              key_findings: ["Alpha gains visibility", "Weak in Amazon Nova"],
              recommendations: [],
              summary: "",
            },
          ],
        });
      }
      if (url.includes("/brands/30/insights")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              visibility_pct: 40,
              key_findings: ["Gamma trailing behind", "Weak in Amazon Nova"],
              recommendations: [],
              summary: "",
            },
          ],
        });
      }

      // 6. Model bias details
      if (url.includes("/brands/10/model-bias")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { model: "us.amazon.nova-pro-v1:0", visibility_pct: 20 },
              { model: "us.anthropic.claude-haiku-4-5-20251001-v1:0", visibility_pct: 80 },
            ],
          }),
        });
      }
      if (url.includes("/brands/30/model-bias")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { model: "us.amazon.nova-pro-v1:0", visibility_pct: 10 },
              { model: "us.anthropic.claude-haiku-4-5-20251001-v1:0", visibility_pct: 40 },
            ],
          }),
        });
      }

      // Fallback response
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  }

  beforeEach(() => {
    originalFetch = global.fetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("loads brand options and permits selection toggling", async () => {
    global.fetch = createFetchMock();

    await act(async () => {
      render(<ComparePage />);
    });

    // Check header and tags
    expect(screen.getByText("Multi-Brand Comparison")).toBeInTheDocument();
    expect(screen.getByText("Parallel Audits")).toBeInTheDocument();

    // Verify option chips render
    await waitFor(() => {
      expect(screen.getAllByText("Alpha App").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Beta App").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Gamma App").length).toBeGreaterThan(0);
    });

    const alphaChip = screen.getByRole("button", { name: /Alpha App/ });
    const betaChip = screen.getAllByRole("button", { name: /^Beta App/ })[0];

    // Alpha and Gamma auto-selected on mount (first 2 audited brands)
    expect(alphaChip).toHaveAttribute("aria-pressed", "true");
    expect(betaChip).toHaveAttribute("aria-pressed", "false");

    // Toggle beta on
    await act(async () => { fireEvent.click(betaChip); });
    expect(betaChip).toHaveAttribute("aria-pressed", "true");

    // Toggle beta off
    await act(async () => { fireEvent.click(betaChip); });
    expect(betaChip).toHaveAttribute("aria-pressed", "false");
  });

  it("supports adding a new brand option and auto-selecting it", async () => {
    global.fetch = createFetchMock();

    await act(async () => {
      render(<ComparePage />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Alpha App").length).toBeGreaterThan(0);
    });

    const input = screen.getByLabelText("New brand name");
    const addButton = screen.getByRole("button", { name: "Add" });

    fireEvent.change(input, { target: { value: "Delta App" } });
    
    await act(async () => {
      fireEvent.click(addButton);
    });

    // Delta App should be added to the DOM and auto-selected
    await waitFor(() => {
      const deltaChip = screen.getByRole("button", { name: "Delta App" });
      expect(deltaChip).toBeInTheDocument();
      expect(deltaChip).toHaveAttribute("aria-pressed", "true");
    });

    // Wait for the comparison reports load to finish before completing the test
    await waitFor(() => {
      expect(screen.getByText("Load report matrix")).toBeInTheDocument();
    });
  });

  it("shows parallel audit button when two brands are selected", async () => {
    global.fetch = createFetchMock();
    render(<ComparePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run 2 audits in parallel/ })).toBeInTheDocument();
    });
  });

  it("auto-loads comparison matrix for pre-selected audited brands", async () => {
    global.fetch = createFetchMock();
    render(<ComparePage />);

    await waitFor(() => {
      expect(screen.getByText("Model Bias Matrix")).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText("Key Differentiator")).toBeInTheDocument();
    expect(screen.getAllByText("Nova Pro").length).toBeGreaterThan(0);
    expect(screen.getByText("Alpha gains visibility")).toBeInTheDocument();
  });
});
