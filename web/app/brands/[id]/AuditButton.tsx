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
  events?: { t: number; msg: string }[];
};

type PreviewState = { found: boolean; category: string; summary?: string };

export default function AuditButton({ brandId }: { brandId: number }) {
  const [job, setJob] = useState<JobState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [editCategory, setEditCategory] = useState("");
  const started = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const customRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Dismiss the custom-questions popover when clicking outside it.
  useEffect(() => {
    if (!showCustom) return;
    function onClick(e: MouseEvent) {
      if (customRef.current && !customRef.current.contains(e.target as Node)) setShowCustom(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showCustom]);

  // Persist the active job id per brand so an in-progress audit survives a page
  // refresh — on mount we resume polling instead of showing a dead/empty state.
  const jobKey = `aura_audit_job_${brandId}`;

  function parseCustomQuestions(): string[] {
    return customText
      .split("\n")
      .map(q => q.trim())
      .filter(q => q.length > 5)
      .slice(0, 5);
  }

  function pollJob(job_id: string) {
    let lastEventIdx = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API}/audit/${job_id}`);
        if (r.status === 404) {
          // Job vanished (server restarted). Stop cleanly rather than looping forever.
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(jobKey);
          started.current = false;
          setJob(null);
          setLog([]);
          return;
        }
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j: JobState = await r.json();
        setJob(j);

        // Append only events we haven't shown yet — index cursor means nothing is
        // lost between the 3s polls (the backend accumulates the full ordered list).
        const evs = j.events ?? [];
        if (evs.length > lastEventIdx) {
          const fresh = evs.slice(lastEventIdx).map(e => e.msg);
          setLog(prev => [...prev, ...fresh]);
          lastEventIdx = evs.length;
        }

        if (j.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(jobKey);
          setLog(prev => [...prev, `✓ Audit finalized: ${j.visibility_pct?.toFixed(1)}% brand visibility`]);
          setTimeout(() => reloadPage(), 1200);
        } else if (j.status === "unconfirmed") {
          // Couldn't confidently identify which company the user means.
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(jobKey);
          started.current = false;
          setLog(prev => [...prev, "✗ Couldn't confirm this brand. Add your website domain so we audit the right company."]);
        } else if (j.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(jobKey);
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

  // Step 1: cheap preview (web search + category inference, no probes) so the user can
  // confirm/correct the category before spending a full audit (e.g. "Fitness" could mean
  // an app or a gym). Shows the confirm card; the actual audit runs from there.
  async function runPreview() {
    if (started.current || previewing) return;
    setPreviewing(true);
    setLog([]);
    const sess = getSessionId();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sess === "admin") headers["X-Admin-Key"] = getAdminKey();
    try {
      const res = await fetch(`${API}/audit/brands/${brandId}/preview?session_id=${sess}`, { method: "POST", headers });
      const data = res.ok ? await res.json() : { found: true, category: "", summary: "" };
      setPreview(data);
      setEditCategory(data.category ?? "");
    } catch {
      // If preview fails, don't block — let the user run the audit with no override.
      setPreview({ found: true, category: "", summary: "" });
      setEditCategory("");
    } finally {
      setPreviewing(false);
    }
  }

  // Step 2: run the actual audit, optionally with the user-confirmed category.
  async function startAudit(categoryOverride?: string) {
    if (started.current) return;
    started.current = true;
    setPreview(null);
    setJob({ status: "queued" });
    setLog(["Initializing audit session…"]);

    const sess = getSessionId();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sess === "admin") {
      headers["X-Admin-Key"] = getAdminKey();
    }

    // Custom questions entered on the homepage form are handed off via sessionStorage;
    // they take precedence over the brand-page popover (used for manual re-runs).
    const stashed = JSON.parse(sessionStorage.getItem(`aura_cq_${brandId}`) || "[]");
    sessionStorage.removeItem(`aura_cq_${brandId}`);
    const custom_questions = stashed.length ? stashed : parseCustomQuestions();
    const body: Record<string, unknown> = { custom_questions };
    if (categoryOverride && categoryOverride.trim()) body.category = categoryOverride.trim();
    const res = await fetch(`${API}/audit/brands/${brandId}?session_id=${sess}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 503) {
      const data = await res.json().catch(() => ({}));
      setJob({ status: "failed", error: data.message ?? "Server is too busy. Please try again in a few minutes." });
      started.current = false;
      return;
    }
    if (!res.ok) {
      // Surface the server's real message (e.g. "an audit is already running",
      // "audit limit exceeded") instead of a generic failure.
      const data = await res.json().catch(() => ({}));
      setJob({ status: "failed", error: typeof data.detail === "string" ? data.detail : "Failed to start audit job." });
      started.current = false;
      return;
    }

    const { job_id } = await res.json();
    localStorage.setItem(jobKey, job_id);
    pollJob(job_id);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autostart") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      runPreview();  // show the confirm card first, then the user runs the audit
      return;
    }
    // Resume an audit that was in progress before a refresh.
    const stored = localStorage.getItem(jobKey);
    if (stored) {
      started.current = true;
      setJob({ status: "running" });
      setLog(["Resuming in-progress audit…"]);
      pollJob(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = job?.status === "running" || job?.status === "queued";
  const done = job?.status === "completed";
  const failed = job?.status === "failed";
  const unconfirmed = job?.status === "unconfirmed";

  const customQuestions = parseCustomQuestions();

  return (
    <div className="flex flex-col items-end gap-2 relative">
      {/* Custom questions — anchored popover so it overlays instead of shifting layout */}
      {!running && !done && (
        <div ref={customRef} className="relative">
          <button
            onClick={() => setShowCustom(v => !v)}
            className="text-[11px] text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Test your own questions
            {customQuestions.length > 0 && (
              <span className="ml-0.5 px-1.5 py-px rounded-full bg-[var(--accent-dim)] text-[var(--accent)] text-[10px] font-bold tabular">
                {customQuestions.length}
              </span>
            )}
            <ChevronDown className={`w-3 h-3 transition-transform ${showCustom ? "rotate-180" : ""}`} />
          </button>
          {showCustom && (
            <div className="absolute right-0 top-full mt-2 z-20 w-72 rounded-xl border border-slate-200 bg-white shadow-lg p-3 space-y-2">
              <p className="text-xs text-slate-700 font-bold">Test your own questions</p>
              <p className="text-[11px] text-slate-400 font-medium leading-snug">
                Add specific buyer questions you want checked. Up to 5, one per line. These run first, before the auto-generated ones.
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
        onClick={() => runPreview()}
        disabled={running || previewing || !!preview}
        className="btn-primary flex items-center gap-2 text-sm relative overflow-hidden"
        aria-label={running ? "Running audit queries" : "Execute brand audit queries"}
      >
        {running ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-white" />
            <span>Auditing…</span>
          </>
        ) : previewing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-white" />
            <span>Checking…</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4 text-white fill-white" />
            <span>Run Audit</span>
          </>
        )}
      </button>

      {/* Confirm card: what Aura understood, before spending the audit. The user can
          correct the category (e.g. change "fitness app" to "gym") so the scored
          questions match what they actually mean. */}
      {preview && !running && (
        <div className="w-80 rounded-xl border border-slate-200 bg-white shadow-lg p-4 space-y-3 text-left">
          {preview.found ? (
            <>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Before we run the audit</p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">Category we&apos;ll test</p>
                <p className="text-[11px] text-slate-400 font-medium leading-snug mt-0.5">
                  We score whether your brand surfaces for buyers asking about this category. Edit it if it&apos;s not quite right.
                </p>
              </div>
              <input
                value={editCategory}
                onChange={e => setEditCategory(e.target.value)}
                placeholder="e.g. premium chocolate, gym membership"
                className="w-full text-sm text-slate-800 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] font-semibold"
              />
              <div className="flex items-center gap-2">
                <button onClick={() => startAudit(editCategory)} className="btn-primary flex-1 flex items-center justify-center gap-1.5 text-xs">
                  <Play className="w-3.5 h-3.5 text-white fill-white" /> Run audit
                </button>
                <button onClick={() => { setPreview(null); setLog([]); }} className="btn-ghost text-xs px-3">Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-slate-800">We couldn&apos;t confirm this brand</p>
                  <p className="text-[11px] text-slate-500 font-medium leading-snug mt-0.5">
                    Add the brand&apos;s website domain so we audit the right company, or set the category manually and run anyway.
                  </p>
                </div>
              </div>
              <input
                value={editCategory}
                onChange={e => setEditCategory(e.target.value)}
                placeholder="Set category, e.g. gym membership"
                className="w-full text-sm text-slate-800 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] font-semibold"
              />
              <div className="flex items-center gap-2">
                <button onClick={() => startAudit(editCategory)} disabled={!editCategory.trim()} className="btn-primary flex-1 text-xs disabled:opacity-50">Run anyway</button>
                <button onClick={() => { setPreview(null); setLog([]); }} className="btn-ghost text-xs px-3">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Phase stepper — shows the user what stage the audit is in */}
      {(running || done) && (
        <div className="w-80 flex items-center gap-1.5">
          {[
            { key: "questions", label: "Questions" },
            { key: "probing", label: "Probing" },
            { key: "analyzing", label: "Analyzing" },
          ].map((p, idx) => {
            const probes = job?.probe_count ?? 0;
            const phase = done ? 3 : probes > 0 ? 2 : 1; // 1=questions,2=probing,3=done
            const active = idx + 1 <= phase;
            return (
              <div key={p.key} className="flex-1 flex flex-col items-center gap-1">
                <div className={`w-full h-1 rounded-full transition-colors ${active ? "bg-[var(--accent)]" : "bg-slate-200"}`} />
                <span className={`text-[9px] font-bold uppercase tracking-wide ${active ? "text-[var(--accent)]" : "text-slate-300"}`}>{p.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* High-fidelity Live Log Console — while running it anchors as a prominent
          fixed panel (top-center on desktop) so the "live search" is the star of the
          show, not a cramped corner widget. Falls back to inline once complete. */}
      {log.length > 0 && (
        <div
          className={`rounded-xl p-4 text-left border shadow-2xl transition-all duration-300 ${
            running
              ? "fixed left-1/2 -translate-x-1/2 top-20 z-40 w-[min(92vw,640px)]"
              : "w-80"
          }`}
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
              {unconfirmed && <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Brand unconfirmed</span>}
              {running && <span className="text-[10px] text-zinc-500 font-bold tabular">{job?.probe_count ?? 0}/10 queries</span>}
            </div>
          </div>

          <div className={`flex flex-col gap-1.5 overflow-y-auto pr-1 ${running ? "max-h-64" : "max-h-36"}`}>
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
