"use client";

import { useState, useEffect, useRef } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type JobState = {
  status: string;
  probe_count?: number;
  visibility_pct?: number;
  summary?: string;
  error?: string;
};

export default function AuditButton({ brandId }: { brandId: number }) {
  const [job, setJob] = useState<JobState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const started = useRef(false);

  async function startAudit() {
    if (started.current) return;       // guard against double-fire
    started.current = true;
    setJob({ status: "queued" });
    setLog(["Starting audit…"]);

    const res = await fetch(`${API}/audit/brands/${brandId}`, { method: "POST" });
    if (!res.ok) { setJob({ status: "failed", error: "Failed to start." }); started.current = false; return; }

    const { job_id } = await res.json();
    setLog(prev => [...prev, `Generating probe questions…`]);

    let lastProbeCount = 0;
    const poll = setInterval(async () => {
      const r = await fetch(`${API}/audit/${job_id}`);
      const j: JobState = await r.json();
      setJob(j);

      if ((j.probe_count ?? 0) > lastProbeCount) {
        lastProbeCount = j.probe_count ?? 0;
        setLog(prev => [...prev, `Probe ${lastProbeCount} complete`]);
      }

      if (j.status === "completed") {
        clearInterval(poll);
        setLog(prev => [...prev, `✓ Done — ${j.visibility_pct?.toFixed(1)}% visibility`]);
        setTimeout(() => window.location.reload(), 1200);
      } else if (j.status === "failed") {
        clearInterval(poll);
        started.current = false;
        setLog(prev => [...prev, `✗ Failed: ${j.error}`]);
      }
    }, 3000);
  }

  // Auto-start when arriving from "Add & Audit" (URL ?autostart=1), then strip the param.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autostart") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      startAudit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = job?.status === "running" || job?.status === "queued";
  const done = job?.status === "completed";
  const failed = job?.status === "failed";

  return (
    <div className="flex flex-col items-end gap-2">
      <button onClick={startAudit} disabled={running}
        className="px-4 py-2 rounded-lg font-medium text-sm text-white transition-colors disabled:cursor-not-allowed"
        style={{ background: running ? "var(--border-2)" : "var(--accent)" }}
      >
        {running ? "Auditing…" : "Run Audit"}
      </button>

      {/* Live log */}
      {log.length > 0 && (
        <div className="w-72 rounded-lg p-3 text-left" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-2">
            {running && <span className="live-dot" />}
            {done && <span className="text-xs" style={{ color: "var(--green)" }}>✓ Complete — refreshing</span>}
            {failed && <span className="text-xs" style={{ color: "var(--red)" }}>✗ Failed</span>}
            {running && <span className="text-xs" style={{ color: "var(--text-3)" }}>{job?.probe_count ?? 0} probes done</span>}
          </div>
          <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
            {log.map((line, i) => (
              <span key={i} className="text-xs mono"
                style={{ color: line.startsWith("✓") ? "var(--green)" : line.startsWith("✗") ? "var(--red)" : "var(--text-3)" }}>
                {line}
              </span>
            ))}
          </div>
          {running && (
            <div className="mt-2 w-full rounded-full h-1" style={{ background: "var(--border)" }}>
              <div className="h-1 rounded-full transition-all" style={{ width: `${Math.min((job?.probe_count ?? 0) * 10, 90)}%`, background: "var(--accent)" }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
