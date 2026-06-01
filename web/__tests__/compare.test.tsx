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
      expect(screen.getByText("Alpha App")).toBeInTheDocument();
      expect(screen.getByText("Beta App")).toBeInTheDocument();
      expect(screen.getByText("Gamma App")).toBeInTheDocument();
    });

    const alphaChip = screen.getByRole("button", { name: "Alpha App 82%" });
    const betaChip = screen.getByRole("button", { name: "Beta App" });

    // Verify pressed state is false initially
    expect(alphaChip).toHaveAttribute("aria-pressed", "false");
    expect(betaChip).toHaveAttribute("aria-pressed", "false");

    // Click alpha and beta to select them
    await act(async () => {
      fireEvent.click(alphaChip);
    });
    await waitFor(() => {
      expect(screen.getByText("Load report matrix")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(betaChip);
    });
    await waitFor(() => {
      expect(screen.getByText("Load report matrix")).toBeInTheDocument();
    });

    expect(alphaChip).toHaveAttribute("aria-pressed", "true");
    expect(betaChip).toHaveAttribute("aria-pressed", "true");

    // Click beta again to deselect
    await act(async () => {
      fireEvent.click(betaChip);
    });
    await waitFor(() => {
      expect(screen.getByText("Load report matrix")).toBeInTheDocument();
    });

    expect(betaChip).toHaveAttribute("aria-pressed", "false");
    expect(alphaChip).toHaveAttribute("aria-pressed", "true");
  });

  it("supports adding a new brand option and auto-selecting it", async () => {
    global.fetch = createFetchMock();

    await act(async () => {
      render(<ComparePage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Alpha App")).toBeInTheDocument();
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

  it("handles running parallel audits with status updates", async () => {
    jest.useFakeTimers();
    global.fetch = createFetchMock();

    try {
      await act(async () => {
        render(<ComparePage />);
      });

      // Wait for options chip list to render
      // Note: we yield to the microtask queue manually since waitFor hangs under fake timers
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await Promise.resolve();
        });
      }

      const alphaChip = screen.getByRole("button", { name: "Alpha App 82%" });
      const gammaChip = screen.getByRole("button", { name: "Gamma App 42%" });

      // Select options
      await act(async () => {
        fireEvent.click(alphaChip);
      });
      await act(async () => {
        fireEvent.click(gammaChip);
      });

      // Flush microtasks to allow initial comparison fetches to resolve
      for (let i = 0; i < 10; i++) {
        await act(async () => {
          await Promise.resolve();
        });
      }

      const runButton = screen.getByRole("button", { name: /Run 2 audits in parallel/ });
      expect(runButton).toBeInTheDocument();

      // Trigger parallel run
      await act(async () => {
        fireEvent.click(runButton);
      });

      // Check status layout rows render
      expect(screen.getAllByText("Alpha App").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Gamma App").length).toBeGreaterThan(0);

      // First poll iteration: Alpha running, Gamma completed
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      // Flush microtasks for the first status checks
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await Promise.resolve();
        });
      }

      expect(screen.getByText("4/10 probes")).toBeInTheDocument(); // Alpha status text
      expect(screen.getByText("90%")).toBeInTheDocument(); // Gamma status text

      // Second poll iteration: Alpha completed
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      // Flush microtasks for the completed status and subsequent loadComparison fetch resolving
      for (let i = 0; i < 20; i++) {
        await act(async () => {
          await Promise.resolve();
        });
      }

      // Audits finalized, layout should resolve loaded scores
      expect(screen.getAllByText("60%").length).toBeGreaterThan(0); // Alpha score card percentage
      expect(screen.getAllByText("90%").length).toBeGreaterThan(0); // Gamma score card percentage
    } finally {
      jest.useRealTimers();
    }
  });

  it("displays bias matrices, bento highlights, and common blindspots/strengths", async () => {
    global.fetch = createFetchMock();

    await act(async () => {
      render(<ComparePage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Alpha App")).toBeInTheDocument();
    });

    // Toggle options
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Alpha App 82%" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gamma App 42%" }));
    });

    // Wait for comparison tables and highlights cards to load automatically
    await waitFor(() => {
      expect(screen.getByText("Model Bias Matrix")).toBeInTheDocument();
      expect(screen.getByText("Key Differentiator")).toBeInTheDocument();
    });

    // Check Bias Matrix scores
    expect(screen.getAllByText("Nova Pro").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Claude Haiku 4.5").length).toBeGreaterThan(0);
    
    // Alpha scores 20% on Nova and 80% on Claude. Gamma scores 10% on Nova and 40% on Claude.
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getAllByText("40%").length).toBeGreaterThan(0);

    // Check bento card: Common Gap (Nova Pro is common blind spot: both scores are <35%)
    expect(screen.getByText("Common Gap")).toBeInTheDocument();
    expect(screen.getByText("Every brand is missing in:")).toBeInTheDocument();
    
    // Check bento card: Key Differentiator (Claude Haiku 4.5 spread is 80 - 40 = 40%)
    expect(screen.getByText("40pt gap")).toBeInTheDocument();
    expect(screen.getByText(/leads, while/)).toBeInTheDocument();
    expect(screen.getByText(/lags/)).toBeInTheDocument();

    // Verify key findings compare layout renders
    expect(screen.getAllByText("Alpha App").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gamma App").length).toBeGreaterThan(0);
    expect(screen.getByText("Alpha gains visibility")).toBeInTheDocument();
    expect(screen.getByText("Gamma trailing behind")).toBeInTheDocument();
  });
});
