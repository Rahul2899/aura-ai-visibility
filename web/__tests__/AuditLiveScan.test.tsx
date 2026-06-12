import React from "react";
import { render, screen } from "@testing-library/react";
import AuditLiveScan from "../app/brands/[id]/AuditLiveScan";

describe("AuditLiveScan — bound to REAL job state only (no fabricated progress)", () => {
  it("lights exactly one node per resolved probe, never more than probeCount", () => {
    render(
      <AuditLiveScan
        brandName="Ashby"
        probeCount={3}
        total={10}
        status="running"
        events={[{ t: 0, msg: "Probe 1" }, { t: 1, msg: "Probe 2" }]}
      />
    );
    // 3 probes resolved -> 3 lit nodes, even though only 2 events arrived. Bound to
    // probeCount (the real count from the backend), not the event-stream length.
    expect(screen.getAllByTestId("scan-node-lit")).toHaveLength(3);
  });

  it("never lights more nodes than the total", () => {
    render(<AuditLiveScan brandName="X" probeCount={99} total={10} status="running" events={[]} />);
    expect(screen.getAllByTestId("scan-node-lit").length).toBeLessThanOrEqual(10);
  });

  it("queued/idle shows an establishing state and zero lit nodes (no fake motion)", () => {
    render(<AuditLiveScan brandName="X" probeCount={0} total={10} status="queued" events={[]} />);
    expect(screen.getByText(/establishing/i)).toBeInTheDocument();
    expect(screen.queryByTestId("scan-node-lit")).toBeNull();
  });

  it("streams the verbatim backend event messages (no invented text)", () => {
    render(
      <AuditLiveScan
        brandName="X"
        probeCount={1}
        total={10}
        status="running"
        events={[{ t: 0, msg: "Searching the web for Ashby" }]}
      />
    );
    expect(screen.getByText(/Searching the web for Ashby/)).toBeInTheDocument();
  });

  it("shows the live probe counter as k/total", () => {
    render(<AuditLiveScan brandName="X" probeCount={4} total={10} status="running" events={[]} />);
    expect(screen.getByText(/4\s*\/\s*10/)).toBeInTheDocument();
  });
});
