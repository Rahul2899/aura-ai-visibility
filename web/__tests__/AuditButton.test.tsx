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
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("handles the full audit lifecycle (start, polling, completed, reload)", async () => {
    // Mock the start and status endpoints
    const mockStartResponse = { job_id: "job_123", status: "queued" };
    const mockStatusRunningResponse = { status: "running", probe_count: 3 };
    const mockStatusCompletedResponse = { status: "completed", probe_count: 10, visibility_pct: 65.5 };

    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    // 1. First call: Start audit (POST)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStartResponse,
    });

    render(<AuditButton brandId={brandId} />);

    // Search by its accessible aria-label
    const button = screen.getByRole("button", { name: "Execute brand audit queries" });
    expect(button).toBeInTheDocument();

    // Trigger Audit
    await act(async () => {
      fireEvent.click(button);
    });

    // Button should show running aria-label state
    expect(screen.getByRole("button", { name: "Running audit queries" })).toBeInTheDocument();
    expect(screen.getByText(/Initializing audit session…/)).toBeInTheDocument();

    // Verify first POST call was made
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

    expect(screen.getByText(/Generating category-specific probe questions…/)).toBeInTheDocument();
    expect(screen.getByText("3/10 queries")).toBeInTheDocument();

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

    // Mock Start
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ job_id: "job_err" }),
    });

    render(<AuditButton brandId={brandId} />);
    const button = screen.getByRole("button", { name: "Execute brand audit queries" });

    await act(async () => {
      fireEvent.click(button);
    });

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
});
