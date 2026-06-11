import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import AuditButton from "../app/brands/[id]/AuditButton";
import { reloadPage } from "../app/lib/navigation";

// Mock the navigation helper
jest.mock("../app/lib/navigation", () => ({
  reloadPage: jest.fn(),
}));

describe("AuditButton Component", () => {
  const brandId = 42;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    originalFetch = global.fetch;
    (reloadPage as jest.Mock).mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    localStorage.clear();
  });

  // The audit now has a preview/confirm step: clicking "Run Audit" first fetches a
  // category preview and shows a confirm card; the real audit starts when the user
  // clicks "Run audit" in that card. This helper queues the preview response, drives
  // both clicks, and queues the caller-supplied audit-start response in between.
  async function clickRunAndConfirm(fetchMock: jest.Mock, startResponse: unknown) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ found: true, category: "note app", summary: "" }) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Execute brand audit queries" }));
    });
    // Card is up; queue the start response, then click the card's "Run audit".
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => startResponse });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Run audit$/ }));
    });
  }

  it("handles the full audit lifecycle (start, polling, completed, reload)", async () => {
    // Mock the start and status endpoints
    const mockStartResponse = { job_id: "job_123", status: "queued" };
    // The live feed is now driven by real backend events streamed in the job's
    // `events` array (index-synced by the poller), not inferred client-side strings.
    const mockStatusRunningResponse = {
      status: "running",
      probe_count: 3,
      events: [
        { t: 1, msg: "Searching the web for brand context…" },
        { t: 2, msg: "Asking 4 models: \"best note app?…\"" },
      ],
    };
    const mockStatusCompletedResponse = { status: "completed", probe_count: 10, visibility_pct: 65.5, events: [] };

    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    render(<AuditButton brandId={brandId} />);

    // Search by its accessible aria-label
    const button = screen.getByRole("button", { name: "Execute brand audit queries" });
    expect(button).toBeInTheDocument();

    // Click Run Audit -> preview -> confirm card -> Run audit (starts the real audit)
    await clickRunAndConfirm(fetchMock, mockStartResponse);

    // Button should show running aria-label state
    expect(screen.getByRole("button", { name: "Running audit queries" })).toBeInTheDocument();
    // While running, the live scan instrument is the feedback the user sees.
    expect(screen.getByText(/Scanning AI models/i)).toBeInTheDocument();

    // Verify the audit-start POST was made (the second POST, after the preview)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/audit/brands/${brandId}`), expect.objectContaining({
      method: "POST",
    }));

    // 2. Mock Second call: Poll status (GET - running)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusRunningResponse,
    });

    // Tick timers for polling interval (3000ms)
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.getByText(/Searching the web for brand context…/)).toBeInTheDocument();
    // The scan's live counter reflects the real probe count from the job.
    expect(screen.getByText(/3\s*\/\s*10 probes/)).toBeInTheDocument();

    // 3. Mock Third call: Poll status (GET - completed)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusCompletedResponse,
    });

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.getByText(/Audit finalized: 65.5% brand visibility/)).toBeInTheDocument();
    expect(screen.getByText(/Complete/)).toBeInTheDocument();

    // 4. Tick timer for reload delay (1200ms)
    await act(async () => {
      jest.advanceTimersByTime(1200);
    });

    expect(reloadPage).toHaveBeenCalled();
  });

  it("handles audit failures gracefully", async () => {
    const mockStatusFailedResponse = { status: "failed", error: "Rate limit exceeded" };
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    render(<AuditButton brandId={brandId} />);

    // Run Audit -> preview -> confirm -> start
    await clickRunAndConfirm(fetchMock, { job_id: "job_err" });

    // Mock Failed status check
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatusFailedResponse,
    });

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.getByText(/Audit failed: Rate limit exceeded/)).toBeInTheDocument();
    expect(screen.getByText(/Failed/)).toBeInTheDocument();
  });

  it("persists job_id to localStorage on start", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    render(<AuditButton brandId={brandId} />);
    await clickRunAndConfirm(fetchMock, { job_id: "job_persist", status: "queued" });

    expect(localStorage.getItem(`aura_audit_job_${brandId}`)).toBe("job_persist");
  });

  it("resumes polling from a stored job on mount", async () => {
    localStorage.setItem(`aura_audit_job_${brandId}`, "job_resume");
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "running", probe_count: 5 }),
    });
    global.fetch = fetchMock;

    render(<AuditButton brandId={brandId} />);
    // Resuming an in-progress audit immediately shows the live scan instrument.
    expect(screen.getByText(/Scanning AI models/i)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    // Polled the stored job, not started a new one (GET, not POST)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/audit/job_resume"));
  });

  it("clears stored job and resets when server returns 404 (server restarted)", async () => {
    localStorage.setItem(`aura_audit_job_${brandId}`, "job_gone");
    const fetchMock = jest.fn().mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({ detail: "Job not found" }),
    });
    global.fetch = fetchMock;

    render(<AuditButton brandId={brandId} />);
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(localStorage.getItem(`aura_audit_job_${brandId}`)).toBeNull();
  });
});
