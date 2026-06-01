"use client";

import { useState, useEffect, useRef } from "react";
import { reloadPage } from "../../lib/navigation";
import { getSessionId, getAdminKey } from "../../lib/session";
import { Play, Loader2, CheckCircle2, AlertCircle, Terminal } from "lucide-react";

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function startAudit() {
    if (started.current) return; // guard against double-fire
    started.current = true;
    setJob({ status: "queued" });
    setLog(["Initializing audit session…"]);

    const sess = getSessionId();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sess === "admin") {
      headers["X-Admin-Key"] = getAdminKey();
    }

    const res = await fetch(`${API}/audit/brands/${brandId}?session_id=${sess}`, {
      method: "POST",
      headers,
    });
    if (!res.ok) {
      setJob({ status: "failed", error: "Failed to start audit job." });
      started.current = false;
      return;
    }

    const { job_id } = await res.json();
    setLog(prev => [...prev, `Generating category-specific probe questions…`]);

    let lastProbeCount = 0;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API}/audit/${job_id}`);
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j: JobState = await r.json();
        setJob(j);

        if ((j.probe_count ?? 0) > lastProbeCount) {
          lastProbeCount = j.probe_count ?? 0;
          setLog(prev => [...prev, `Probe query ${lastProbeCount} completed successfully`]);
        }

        if (j.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setLog(prev => [...prev, `✓ Audit finalized: ${j.visibility_pct?.toFixed(1)}% brand visibility`]);
          setTimeout(() => reloadPage(), 1200);
        } else if (j.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          started.current = false;
          setLog(prev => [...prev, `✗ Audit failed: ${j.error}`]);
        }
      } catch (e) {
        if (pollRef.current) clearInterval(pollRef.current);
        started.current = false;
        setJob({ status: "failed", error: String(e) });
      }
    }, 3000);
  }

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
    <div className="flex flex-col items-end gap-3 relative">
      <button
        onClick={startAudit}
        disabled={running}
        className="btn-primary flex items-center gap-2 text-sm relative overflow-hidden"
        aria-label={running ? "Running audit queries" : "Execute brand audit queries"}
      >
        {running ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-white" />
            <span>Auditing…</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4 text-white fill-white" />
            <span>Run Audit</span>
          </>
        )}
      </button>

      {/* High-fidelity Live Log Console */}
      {log.length > 0 && (
        <div
          className="w-80 rounded-xl p-4 text-left border shadow-2xl transition-all duration-300"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          role="log"
          aria-live="polite"
        >
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-900">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Audit Logs</span>
            </div>
            <div className="flex items-center gap-2">
              {running && <span className="live-dot" />}
              {done && <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Complete</span>}
              {failed && <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Failed</span>}
              {running && <span className="text-[10px] text-zinc-500 font-bold tabular">{job?.probe_count ?? 0}/10 queries</span>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
            {log.map((line, i) => {
              const isDone = line.startsWith("✓");
              const isFail = line.startsWith("✗");
              const color = isDone ? "var(--green)" : isFail ? "var(--red)" : "var(--text-2)";
              return (
                <span
                  key={i}
                  className="text-xs font-semibold mono leading-relaxed tracking-tight"
                  style={{ color }}
                >
                  {isDone ? "✔ " : isFail ? "✖ " : "> "}{line.replace(/^[✓✗]\s*/, "")}
                </span>
              );
            })}
          </div>

          {/* Progress bar with glowing details */}
          {running && (
            <div className="mt-3.5 w-full rounded-full h-1 bg-zinc-950 overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-1000 ease-out"
                style={{ width: `${Math.min((job?.probe_count ?? 0) * 10, 95)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
