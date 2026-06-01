import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import Home from "../app/page";
import { reloadPage } from "../app/lib/navigation";

// Mock the navigation helper
jest.mock("../app/lib/navigation", () => ({
  reloadPage: jest.fn(),
}));

describe("Homepage Dashboard Component", () => {
  let originalFetch: typeof global.fetch;
  let originalConfirm: typeof window.confirm;
  let originalPrompt: typeof window.prompt;
  let originalAlert: typeof window.alert;

  const mockBrandsList = [
    {
      id: 1,
      name: "Acme Cloud",
      domain: "acme.com",
      visibility_pct: 78.5,
      trend: 4.2,
      probe_count: 10,
      last_run: "2026-05-30T12:00:00Z",
      session_id: "user1"
    },
    {
      id: 2,
      name: "Beta Tech",
      domain: "betatech.io",
      visibility_pct: 45.0,
      trend: -1.5,
      probe_count: 10,
      last_run: "2026-05-30T12:00:00Z",
      session_id: "user1"
    },
    {
      id: 3,
      name: "Delta System",
      domain: "deltasys.net",
      visibility_pct: null, // Unaudited brand
      trend: null,
      probe_count: 0,
      last_run: null,
      session_id: "user1"
    }
  ];

  beforeEach(() => {
    originalFetch = global.fetch;
    originalConfirm = window.confirm;
    originalPrompt = window.prompt;
    originalAlert = window.alert;

    localStorage.clear();
    (reloadPage as jest.Mock).mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.confirm = originalConfirm;
    window.prompt = originalPrompt;
    window.alert = originalAlert;
  });

  it("renders loader initially and then renders empty onboarding state when no brands exist", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/audit/limit-status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ limit_reached: false, count: 0, max: 2 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });

    render(<Home />);

    expect(screen.getByText("Loading brands database...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Loading brands database...")).not.toBeInTheDocument();
    });

    // Verify onboarding elements are shown
    expect(screen.getByText("How Aura works")).toBeInTheDocument();
    expect(screen.getByText("Audit Your Brand's Mentions Across Top AI Models")).toBeInTheDocument();
    expect(screen.getByText("Configure")).toBeInTheDocument();
    expect(screen.getByText("Probing")).toBeInTheDocument();
    expect(screen.getByText("Evaluate")).toBeInTheDocument();
    expect(screen.getByText("Analyze")).toBeInTheDocument();
    
    // Check mock graph preview is present
    expect(screen.getByText("Anthropic Claude 3.5 Sonnet")).toBeInTheDocument();
    expect(screen.getByText("Meta Llama 3.3 70B")).toBeInTheDocument();
    expect(screen.getByText("Amazon Nova Pro")).toBeInTheDocument();
    
    // Sidebar form elements
    expect(screen.getByLabelText("Brand name")).toBeInTheDocument();
    expect(screen.getByLabelText("Brand domain")).toBeInTheDocument();
  });

  it("renders a list of audited and unaudited brands when database holds records", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/audit/limit-status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ limit_reached: false, count: 0, max: 2 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockBrandsList,
      });
    });

    await act(async () => {
      render(<Home />);
    });

    await waitFor(() => {
      expect(screen.queryByText("Loading brands database...")).not.toBeInTheDocument();
    });

    // Check summary cards
    expect(screen.getByText("Brands Tracked")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Cloud").length).toBeGreaterThan(0);
    expect(screen.getByText("acme.com")).toBeInTheDocument();
    expect(screen.getByText("Beta Tech")).toBeInTheDocument();
    expect(screen.getByText("betatech.io")).toBeInTheDocument();

    // Check score chips
    expect(screen.getByText("79%")).toBeInTheDocument(); // Score rounded
    expect(screen.getByText("45%")).toBeInTheDocument(); // Score rounded

    // Verify unaudited brand appears in "Unaudited Brands" sidebar container
    expect(screen.getByText("Unaudited Brands")).toBeInTheDocument();
    expect(screen.getByText("Delta System")).toBeInTheDocument();
  });

  it("filters brand list dynamically based on search query", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/audit/limit-status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ limit_reached: false, count: 0, max: 2 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockBrandsList,
      });
    });

    await act(async () => {
      render(<Home />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Acme Cloud").length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByLabelText("Search brand names");
    expect(searchInput).toBeInTheDocument();

    // Type query "acme"
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "acme" } });
    });

    // Acme Cloud should remain, Beta Tech should be hidden
    expect(screen.getAllByText("Acme Cloud").length).toBeGreaterThan(0);
    expect(screen.queryByText("Beta Tech")).not.toBeInTheDocument();

    // Clear search query
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "" } });
    });
    expect(screen.getAllByText("Acme Cloud").length).toBeGreaterThan(0);
    expect(screen.getByText("Beta Tech")).toBeInTheDocument();
  });

  it("handles the admin key toggle flow and updates localStorage", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/audit/limit-status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ limit_reached: false, count: 0, max: 2 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });

    window.prompt = jest.fn().mockReturnValue("secret-admin-passcode");

    render(<Home />);

    await waitFor(() => {
      expect(screen.queryByText("Loading brands database...")).not.toBeInTheDocument();
    });

    const trigger = screen.getByTestId("secret-logo-trigger");
    expect(trigger).toBeInTheDocument();

    await act(async () => {
      fireEvent.doubleClick(trigger);
    });

    expect(window.prompt).toHaveBeenCalledWith("Enter Admin Access Key to authenticate:");
    expect(localStorage.getItem("aura_admin_key")).toBe("secret-admin-passcode");
    expect(localStorage.getItem("aura_admin_mode")).toBe("true");
    expect(reloadPage).toHaveBeenCalled();
  });

  it("automatically rolls back to guest board if backend API returns 401 Unauthorized", async () => {
    // Enable admin mode first
    localStorage.setItem("aura_admin_mode", "true");
    localStorage.setItem("aura_admin_key", "invalid-key");

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/audit/limit-status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ limit_reached: false, count: 0, max: 2 }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 401,
      });
    });

    await act(async () => {
      render(<Home />);
    });

    await waitFor(() => {
      expect(localStorage.getItem("aura_admin_mode")).toBe("false");
      expect(localStorage.getItem("aura_admin_key")).toBeNull();
      expect(reloadPage).toHaveBeenCalled();
    });
  });

  it("supports cascading deletions for brands after confirmation", async () => {
    let loadCount = 0;
    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      if (url.includes("/audit/limit-status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ limit_reached: false, count: 0, max: 2 }),
        });
      }
      if (options?.method === "DELETE") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: "deleted" }),
        });
      }
      if (url.includes("/brands/compare")) {
        loadCount++;
        if (loadCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => mockBrandsList,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => [mockBrandsList[1], mockBrandsList[2]], // Acme Cloud removed
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    window.confirm = jest.fn().mockReturnValue(true);

    await act(async () => {
      render(<Home />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Acme Cloud").length).toBeGreaterThan(0);
    });

    const deleteButton = screen.getByRole("button", { name: "Delete Acme Cloud" });
    expect(deleteButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(deleteButton);
    });

    expect(window.confirm).toHaveBeenCalledWith("Delete this brand and all its data?");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/brands/1"),
      expect.objectContaining({ method: "DELETE" })
    );

    // Verify Acme Cloud is gone after loading again
    await waitFor(() => {
      expect(screen.queryByText("Acme Cloud")).not.toBeInTheDocument();
      expect(screen.getAllByText("Beta Tech").length).toBeGreaterThan(0);
    });
  });

  it("supports exporting tracked brands as CSV", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/audit/limit-status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ limit_reached: false, count: 0, max: 2 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockBrandsList,
      });
    });

    await act(async () => {
      render(<Home />);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Acme Cloud").length).toBeGreaterThan(0);
    });

    // Mock anchor tag triggers
    const mockClick = jest.fn();
    const mockAnchor = {
      click: mockClick,
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      style: {},
      href: "",
      download: "",
    };
    jest.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "a") return mockAnchor as any;
      return document.createElement(tagName);
    });

    // Mock URL object creation
    const mockObjectUrl = "blob:http://localhost:3000/some-uuid";
    global.URL.createObjectURL = jest.fn().mockReturnValue(mockObjectUrl);

    const exportButton = screen.getByRole("button", { name: "Export audited brands as CSV" });
    expect(exportButton).toBeInTheDocument();

    fireEvent.click(exportButton);

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(mockAnchor.download).toContain("ai-visibility-");
    expect(mockAnchor.href).toBe(mockObjectUrl);
    expect(mockClick).toHaveBeenCalled();
  });
});
