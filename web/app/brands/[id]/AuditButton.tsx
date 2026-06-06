"use client";

import { useState, useEffect, useRef } from "react";
import { reloadPage } from "../../lib/navigation";
import { getSessionId, getAdminKey } from "../../lib/session";
import { Play, Loader2, CheckCircle2, AlertCircle, Terminal, ChevronDown, Plus } from "lucide-react";

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
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const started = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function parseCustomQuestions(): string[] {
    return customText
      .split("\n")
      .map(q => q.trim())
      .filter(q => q.length > 5)
      .slice(0, 5);
  }

  async function startAudit() {
    if (started.current) return;
    started.current = true;
    setJob({ status: "queued" });
    setLog(["Initializing audit session…"]);

    const sess = getSessionId();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sess === "admin") {
      headers["X-Admin-Key"] = getAdminKey();
    }

    const custom_questions = parseCustomQuestions();
    const res = await fetch(`${API}/audit/brands/${brandId}?session_id=${sess}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ custom_questions }),
    });
    if (res.status === 503) {
      const data = await res.json().catch(() => ({}));
      setJob({ status: "failed", error: data.message ?? "Server is too busy. Please try again in a few minutes." });
      started.current = false;
      return;
    }
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

  const customQuestions = parseCustomQuestions();

  return (
    <div className="flex flex-col items-end gap-2 relative">
      {/* Custom questions panel */}
      {!running && !done && (
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={() => setShowCustom(v => !v)}
            className="text-[11px] text-slate-400 hover:text-slate-600 font-semibold flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Custom questions
            <ChevronDown className={`w-3 h-3 transition-transform ${showCustom ? "rotate-180" : ""}`} />
          </button>
          {showCustom && (
            <div className="w-72 rounded-xl border border-slate-200 bg-white shadow-lg p-3 space-y-2">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                Add up to 5 questions to test (one per line)
              </p>
              <textarea
                value={customText}
                onChange={e => setCustomText(e.target.value)}
                placeholder={"Does Ashby integrate with Greenhouse?\nWhich ATS supports async video interviews?"}
                className="w-full text-xs text-slate-700 border border-slate-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent)] font-medium leading-relaxed"
                rows={4}
              />
              {customQuestions.length > 0 && (
                <p className="text-[10px] text-emerald-600 font-semibold">
                  {customQuestions.length} question{customQuestions.length > 1 ? "s" : ""} will be tested first
                </p>
              )}
            </div>
          )}
        </div>
      )}

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

          {/* Too-busy notice */}
          {failed && job?.error?.includes("busy") && (
            <p className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Server is busy. Wait 2-3 minutes and try again.
            </p>
          )}

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
