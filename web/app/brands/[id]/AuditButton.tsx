"use client";

import { useState, useEffect, useRef } from "react";
import { reloadPage } from "../../lib/navigation";
import { getSessionId, getAdminKey } from "../../lib/session";
import { Play, Loader2, CheckCircle2, AlertCircle, Terminal, ChevronDown, Plus } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type JobState = {
  status: string;
  probe_count?: number;
  visibility_pct?: number;
  summary?: string;
  error?: string;
  events?: { t: number; msg: string }[];
};

type PreviewState = { found: boolean; category: string; summary?: string };

export default function AuditButton({ brandId, brandName = "this brand", isExample = false, onJobChange }: { brandId: number; brandName?: string; isExample?: boolean; onJobChange?: (job: JobState | null) => void }) {
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

  // Report live job state up so the brand page can render the scan in-flow in its body
  // (instead of this component floating a fixed panel over the page).
  useEffect(() => { onJobChange?.(job); }, [job, onJobChange]);

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

      <div className="relative">
      <button
        onClick={() => runPreview()}
        disabled={running || previewing || !!preview || isExample}
        title={isExample ? "Demo brands are read-only. Add your own brand to run a fresh audit." : undefined}
        className="btn-primary flex items-center gap-2 text-sm relative overflow-hidden"
        aria-label={running ? "Running audit queries" : isExample ? "Demo brand — auditing disabled" : "Execute brand audit queries"}
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
        ) : isExample ? (
          <>
            <Play className="w-4 h-4 text-white fill-white" />
            <span>Demo (read-only)</span>
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
          questions match what they actually mean. Anchored as a popover below the
          button so it overlays cleanly instead of floating detached in the layout. */}
      {preview && !running && (
        <div className="absolute right-0 top-full mt-2 z-30 w-80 rounded-xl border border-slate-200 bg-white shadow-xl p-4 space-y-3 text-left">
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
      </div>

      {/* The live spy/scan + phase stepper now render IN-FLOW in the brand-page body
          (via onJobChange), not floating from this header button. */}

      {/* Once finished/failed, fall back to a compact inline log so the result and
          any error are legible. (The scan is only for the live moment.) */}
      {!running && log.length > 0 && (
        <div
          className="rounded-xl p-4 text-left border shadow-lg w-80"
          style={{ background: "var(--surface-solid)", borderColor: "var(--border-solid)" }}
          role="log"
          aria-live="polite"
        >
          <div className="flex items-center justify-between mb-3 pb-2 border-b" style={{ borderColor: "var(--border-solid)" }}>
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--text-3)" }}>Audit Log</span>
            </div>
            <div className="flex items-center gap-2">
              {done && <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1" style={{ color: "var(--green)" }}><CheckCircle2 className="w-3 h-3" /> Complete</span>}
              {failed && <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1" style={{ color: "var(--red)" }}><AlertCircle className="w-3 h-3" /> Failed</span>}
              {unconfirmed && <span className="text-[10px] text-amber-600 font-bold uppercase tracking-wider flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Brand unconfirmed</span>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 overflow-y-auto pr-1 max-h-36">
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

          {/* Always surface WHY an audit failed — the server sends a specific reason
              (limit reached, example brand is read-only, already running, busy). Show
              it plainly instead of leaving the user staring at a bare "Failed". */}
          {failed && job?.error && (
            <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 leading-relaxed">
              {job.error.includes("busy")
                ? "The server is busy right now. Wait 2-3 minutes and try again."
                : job.error.includes("example")
                ? "This is a preloaded demo brand and can't be re-audited. Add your own brand from the dashboard to run a fresh audit."
                : job.error.includes("limit")
                ? "You've reached the free audit limit (2 audits). Please check back later."
                : job.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
