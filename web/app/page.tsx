"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import ComparisonChart from "./components/ComparisonChart";
import MagneticCursor from "./components/MagneticCursor";
import { Reveal, CountUp } from "./components/Reveal";
import { getSessionId, getAdminKey, isAdminMode, setAdminMode, setAdminKey, exitAdmin } from "./lib/session";
import { createBrand, validateBrand } from "./lib/brands";
import { reloadPage } from "./lib/navigation";
import {
  Sparkles,
  GitCompare,
  Download,
  Trophy,
  Trash2,
  ArrowRight,
  ChevronRight,
  Search,
  Plus,
  Globe,
  ChevronDown,
  Building2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Loader2
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Escape user-controlled text before it is interpolated into the PDF's raw HTML
// string. Brand names/industries are user input, so without this a name like
// "<img src=x onerror=...>" would inject markup/script into the print window.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// Build a styled, colorful report and open the browser's print dialog (Save as PDF).
// Score colors match the app: green >=60, amber >=35, red below.
function exportPDF(brands: BrandRow[]) {
  const scoreColor = (p: number | null) =>
    p === null ? { fg: "#64748b", bg: "#f1f5f9" }
    : p >= 60 ? { fg: "#1f8a5b", bg: "#eafaf2" }
    : p >= 35 ? { fg: "#c08321", bg: "#fdf5e6" }
    : { fg: "#d2453f", bg: "#fdeceb" };

  const ranked = [...brands].filter(b => b.visibility_pct !== null)
    .sort((a, b) => (b.visibility_pct ?? 0) - (a.visibility_pct ?? 0));
  const avg = ranked.length ? ranked.reduce((s, b) => s + (b.visibility_pct ?? 0), 0) / ranked.length : 0;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const rows = ranked.map((b, i) => {
    const c = scoreColor(b.visibility_pct);
    const bar = Math.max(b.visibility_pct ?? 0, 2);
    return `<tr>
      <td class="rank">${i + 1}</td>
      <td><span class="bname">${escapeHtml(b.name)}</span>${b.industry ? `<span class="ind">${escapeHtml(b.industry)}</span>` : ""}</td>
      <td><div class="barwrap"><div class="bar" style="width:${bar}%;background:${c.fg}"></div></div></td>
      <td><span class="chip" style="color:${c.fg};background:${c.bg}">${b.visibility_pct?.toFixed(0)}%</span></td>
      <td class="probes">${b.probe_count ?? 0}</td>
    </tr>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Aura AI Visibility Report</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 40px; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1863dc; padding-bottom: 16px; margin-bottom: 24px; }
    .brandmark { font-size: 22px; font-weight: 800; color: #0f4aad; letter-spacing: -0.02em; }
    .sub { color: #64748b; font-size: 13px; margin-top: 2px; }
    .date { color: #94a3b8; font-size: 12px; font-weight: 600; }
    .kpis { display: flex; gap: 14px; margin-bottom: 28px; }
    .kpi { flex: 1; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
    .kpi .lbl { color: #94a3b8; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    .kpi .val { font-size: 26px; font-weight: 800; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; color: #94a3b8; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
    td { padding: 12px 10px; border-bottom: 1px solid #f1f5f9; font-size: 14px; vertical-align: middle; }
    .rank { color: #94a3b8; font-weight: 700; width: 28px; }
    .bname { font-weight: 700; }
    .ind { display: block; color: #94a3b8; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
    .barwrap { background: #f1f5f9; border-radius: 6px; height: 8px; width: 180px; overflow: hidden; }
    .bar { height: 100%; border-radius: 6px; }
    .chip { font-weight: 800; font-size: 13px; padding: 4px 10px; border-radius: 8px; }
    .probes { color: #475569; font-weight: 600; text-align: right; }
    .foot { margin-top: 28px; color: #94a3b8; font-size: 11px; }
  </style></head><body>
    <div class="head">
      <div><div class="brandmark">Aura AI</div><div class="sub">AI Brand Visibility Report</div></div>
      <div class="date">${today}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="lbl">Brands</div><div class="val">${ranked.length}</div></div>
      <div class="kpi"><div class="lbl">Avg Visibility</div><div class="val" style="color:${scoreColor(avg).fg}">${avg.toFixed(0)}%</div></div>
      <div class="kpi"><div class="lbl">Market Leader</div><div class="val">${escapeHtml(ranked[0]?.name ?? "N/A")}</div></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Brand</th><th>Visibility</th><th>Score</th><th style="text-align:right">Probes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot">Generated by Aura AI. Results reflect non-deterministic AI responses and may vary between runs.</div>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

type BrandRow = {
  id: number;
  name: string;
  domain: string | null;
  industry: string | null;
  visibility_pct: number | null;
  trend: number | null;
  probe_count: number;
  last_run: string | null;
  rank?: number;
  is_example?: boolean;
};


function ScoreChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-slate-400 font-semibold bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">No data</span>;
  const isStrong = pct >= 60;
  const isModerate = pct >= 35;
  const textCol = isStrong ? "text-emerald-700" : isModerate ? "text-amber-700" : "text-red-600";
  const bgCol = isStrong ? "bg-emerald-50 border-emerald-200" : isModerate ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";
  return (
    <span className={`text-sm font-bold tabular px-2.5 py-1 rounded-lg border ${textCol} ${bgCol}`}>
      {pct.toFixed(0)}%
    </span>
  );
}

// Shows audits that are still running server-side, so a page refresh never looks
// like the audit was "lost". The brand page writes the running job_id to
// localStorage (aura_audit_job_<brandId>); we read those, poll each job, and surface
// a banner with live status + a link back to the live audit. Clears the key and asks
// the dashboard to reload when a job finishes, so the new score appears.
type ActiveJob = { brandId: number; jobId: string; status: string; progress: string };

function ActiveAudits({ brands, onComplete, onActiveChange }: { brands: BrandRow[]; onComplete: () => void; onActiveChange?: (ids: number[]) => void }) {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);

  // Report the set of in-progress brand ids up to the dashboard so it can move those
  // brands out of the "Unaudited" list into an "Audit in progress" state.
  useEffect(() => { onActiveChange?.(jobs.map(j => j.brandId)); }, [jobs, onActiveChange]);

  useEffect(() => {
    let stop = false;
    async function tick() {
      // Discover running audits from the localStorage keys the brand page writes.
      const found: { brandId: number; jobId: string }[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const m = k?.match(/^aura_audit_job_(\d+)$/);
        if (m) {
          const jobId = localStorage.getItem(k!);
          if (jobId) found.push({ brandId: Number(m[1]), jobId });
        }
      }
      if (found.length === 0) { if (!stop) setJobs([]); return; }

      const results = await Promise.all(found.map(async ({ brandId, jobId }) => {
        try {
          const r = await fetch(`${API}/audit/${jobId}`);
          if (r.status === 404) { localStorage.removeItem(`aura_audit_job_${brandId}`); return null; }
          const d = await r.json();
          const status: string = d.status ?? "running";
          if (status === "completed" || status === "failed" || status === "unconfirmed") {
            localStorage.removeItem(`aura_audit_job_${brandId}`);
            if (status === "completed") onComplete();  // refresh dashboard to show the new score
            return null;
          }
          // Derive a light progress hint from the live event feed (e.g. "Probe 7").
          const evs: { msg: string }[] = d.events ?? [];
          const probe = [...evs].reverse().find(e => /Probe \d+|Asking|Generating|Searching|Scoring/i.test(e.msg));
          return { brandId, jobId, status, progress: probe?.msg?.slice(0, 48) ?? "Starting…" } as ActiveJob;
        } catch { return null; }
      }));
      if (!stop) setJobs(results.filter((j): j is ActiveJob => j !== null));
    }
    tick();
    const iv = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(iv); };
  }, [onComplete]);

  if (jobs.length === 0) return null;
  const nameOf = (id: number) => brands.find(b => b.id === id)?.name ?? `Brand #${id}`;

  return (
    <div className="space-y-2 mb-4">
      {jobs.map(j => (
        <div key={j.brandId} className="card px-4 py-3 flex items-center justify-between gap-3 border-[var(--accent)]/30" style={{ background: "var(--accent-dim)" }}>
          <div className="flex items-center gap-3 min-w-0">
            <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">Auditing {nameOf(j.brandId)}…</p>
              <p className="text-xs text-slate-500 font-medium truncate">{j.progress}</p>
            </div>
          </div>
          <Link href={`/brands/${j.brandId}`} className="btn-ghost text-xs font-bold flex-shrink-0">View</Link>
        </div>
      ))}
    </div>
  );
}

function TrendPill({ v }: { v: number | null }) {
  if (v === null || v === 0) return <span className="text-slate-400 text-xs font-semibold px-2 py-1 bg-slate-100 rounded-lg border border-slate-200">—</span>;
  const up = v > 0;
  return (
    <span className={`text-xs font-bold px-2 py-1 rounded-lg inline-flex items-center gap-1 w-fit ${up ? "bg-emerald-50 text-emerald-700 border border-emerald-300" : "bg-red-50 text-red-600 border border-red-300"}`}>
      {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {up ? "+" : ""}{v.toFixed(1)}%
    </span>
  );
}

export default function Home() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  // Demo (example) brands are shared across all users, so they can't be deleted from
  // the DB (one user must not wipe the demo for everyone). Instead a user can DISMISS
  // them from their own dashboard — stored per-browser in localStorage. Restorable.
  const [dismissedDemo, setDismissedDemo] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState(false);
  const [industries, setIndustries] = useState<string[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [auditCount, setAuditCount] = useState(0);
  const [admin, setAdmin] = useState(false);
  // Brand ids with an audit running right now (reported by ActiveAudits). Used to move
  // them out of the "Unaudited" list and show an "Audit in progress" state instead.
  const [activeIds, setActiveIds] = useState<number[]>([]);
  const onActiveChange = useCallback((ids: number[]) => {
    setActiveIds(prev => (prev.length === ids.length && prev.every(x => ids.includes(x)) ? prev : ids));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sess = getSessionId();
      const adminHdr: Record<string, string> = sess === "admin" ? { "X-Admin-Key": getAdminKey() } : {};
      const [compareRes, limitRes, industriesRes] = await Promise.all([
        // MUST send the admin header here too: without it the server can't verify admin
        // and falls back to the example-only scope, so an admin's own brands vanish on
        // refresh. (The key is computed above for limit-status; reuse it.)
        fetch(`${API}/brands/compare?session_id=${sess}`, { headers: adminHdr }),
        fetch(`${API}/audit/limit-status?session_id=${sess}`, { headers: adminHdr }),
        fetch(`${API}/brands/industries`),
      ]);
      if (compareRes.ok) setBrands(await compareRes.json());
      if (limitRes.ok) {
        const d = await limitRes.json();
        setLimitReached(d.limit_reached);
        setAuditCount(d.count);
      }
      if (industriesRes.ok) { const ind = await industriesRes.json(); setIndustries(Array.isArray(ind) ? ind : []); }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);


  useEffect(() => {
    // Admin activation: visiting /?admin=<ADMIN_KEY> stores the key in sessionStorage
    // and strips it from the URL. The server still verifies the real key on every
    // privileged call (is_admin) — this client flag is cosmetic; a fake flag without
    // the real key gets 403. A normal user with no key never sees admin UI.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const key = params.get("admin");
      if (key) {
        setAdminKey(key);
        setAdminMode(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
      setAdmin(isAdminMode());
      // Restore the user's dismissed demo brands (per-browser preference).
      try {
        const raw = localStorage.getItem("aura_dismissed_demo");
        if (raw) setDismissedDemo(new Set(JSON.parse(raw) as number[]));
      } catch { /* ignore malformed */ }
    }
    load();
  }, [load]);

  function dismissDemo(id: number) {
    setDismissedDemo(prev => {
      const next = new Set(prev).add(id);
      localStorage.setItem("aura_dismissed_demo", JSON.stringify([...next]));
      return next;
    });
  }
  function restoreDemos() {
    setDismissedDemo(new Set());
    localStorage.removeItem("aura_dismissed_demo");
  }

  async function addBrand(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const validationError = validateBrand(name, domain);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setAdding(true);
    const result = await createBrand({ name, domain, industry });
    setAdding(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    // Hand custom questions to the brand page's autostart via sessionStorage —
    // keeps question text out of the URL and survives the same-tab redirect.
    const cq = customText.split("\n").map(q => q.trim()).filter(q => q.length > 5).slice(0, 5);
    if (cq.length) sessionStorage.setItem(`aura_cq_${result.id}`, JSON.stringify(cq));
    window.location.href = `/brands/${result.id}?autostart=1`;
  }

  async function deleteBrand(id: number) {
    const targetBrand = brands.find(b => b.id === id);
    // Demo brands are shared — dismiss from THIS browser instead of deleting from the DB.
    if (targetBrand?.is_example) {
      if (!confirm(`Hide the demo brand "${targetBrand?.name}" from your dashboard? You can restore demos anytime.`)) return;
      dismissDemo(id);
      return;
    }
    if (!confirm(`Delete "${targetBrand?.name ?? "this brand"}" and all its data? This cannot be undone.`)) return;
    setDeleting(id);
    const sess = getSessionId();
    // Admin must send X-Admin-Key to delete brands owned by other sessions.
    const headers: Record<string, string> = {};
    if (sess === "admin") headers["X-Admin-Key"] = getAdminKey();
    const res = await fetch(`${API}/brands/${id}?session_id=${sess}`, { method: "DELETE", headers });
    if (res.status === 403) alert("You can only delete brands you added.");
    setDeleting(null);
    load();
  }

  // Hide the user's dismissed demo brands everywhere on the dashboard.
  const shown = brands.filter(b => !dismissedDemo.has(b.id));
  const hasDismissedDemos = dismissedDemo.size > 0;
  const filtered = search
    ? shown.filter(b => b.name.toLowerCase().includes(search.toLowerCase()))
    : shown;
  const audited = filtered.filter(b => b.visibility_pct !== null);
  const allAudited = shown.filter(b => b.visibility_pct !== null);
  const sortedAudited = [...allAudited].sort((a, b) => (b.visibility_pct ?? 0) - (a.visibility_pct ?? 0));
  const avg = allAudited.length ? allAudited.reduce((s, b) => s + (b.visibility_pct ?? 0), 0) / allAudited.length : null;
  const best = sortedAudited[0] ?? null;
  const notScored = filtered.filter(b => b.visibility_pct === null);
  // A brand with a running audit is "in progress", not "unaudited".
  const inProgress = notScored.filter(b => activeIds.includes(b.id));
  const pending = notScored.filter(b => !activeIds.includes(b.id));

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      <MagneticCursor />
      {/* Top nav */}
      <header className="border-b px-5 sm:px-8 py-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md" style={{ borderColor: "var(--border-solid)", background: "rgba(255,255,255,0.95)" }}>
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--accent)] shadow-md shadow-[var(--accent-glow)] select-none">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm text-slate-900 tracking-tight group-hover:text-[var(--accent)] transition-colors">Aura AI</span>
        </Link>
        {admin ? (
          <button
            onClick={() => { if (confirm("Exit admin mode?")) { exitAdmin(); window.location.reload(); } }}
            title="Click to exit admin mode"
            className="text-[var(--accent)] text-xs font-bold tabular border border-[var(--border-2)] bg-[var(--accent-dim)] px-3 py-1.5 rounded-xl hover:bg-[var(--accent)] hover:text-white transition-colors">
            ADMIN · unlimited
          </button>
        ) : (
          <span className="text-slate-500 text-xs font-semibold tabular border border-slate-200 bg-slate-50 px-3 py-1.5 rounded-xl select-none">
            {Math.max(0, 2 - auditCount)} / 2 Audits left
          </span>
        )}
      </header>

      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-6 space-y-5">
        {/* Hero — tell a first-time visitor exactly what this is */}
        <Reveal>
          <section className="hero-glow text-center max-w-2xl mx-auto pt-5 sm:pt-8 pb-2 space-y-3 px-1">
            <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full border border-[var(--accent)]/30 bg-[var(--accent-dim)] text-[var(--accent-2)]">
              AI Brand Visibility
            </span>
            <h1 className="display text-2xl leading-[1.15] sm:text-5xl sm:leading-[1.05] text-slate-900 px-2 text-balance break-words">
              See how often AI models <span className="text-gradient">recommend</span> your brand
            </h1>
            <p className="text-slate-500 text-sm sm:text-base font-medium leading-relaxed max-w-xl mx-auto">
              When buyers ask AI assistants for recommendations, does your brand show up? Aura runs real buyer questions across four AI models, measures your visibility, and shows exactly where you appear.
            </p>
            <div className="pt-1">
              <a href="#audit-form" data-magnetic className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm">
                <Plus className="w-4 h-4 text-white" /> Audit your brand
              </a>
            </div>
          </section>
        </Reveal>

        {/* In-progress audits (survive a refresh; the work continues server-side) */}
        <ActiveAudits brands={brands} onComplete={load} onActiveChange={onActiveChange} />

        {/* KPI strip — single card, connected; stacks on mobile to avoid overflow */}
        {audited.length > 0 && (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              {[
                { label: "Brands Tracked", value: shown.length.toString(), count: shown.length, suffix: "", sub: `${audited.length} audited` },
                { label: "Avg AI Visibility", value: avg !== null ? `${avg.toFixed(0)}%` : "—", count: avg !== null ? avg : null, suffix: "%", sub: "across all brands", colored: avg },
                { label: "Market Leader", value: best?.name ?? "—", count: null, suffix: "", sub: best ? `${best.visibility_pct?.toFixed(0)}% visibility` : "", colored: best?.visibility_pct },
              ].map(({ label, value, count, suffix, sub, colored }) => (
                <div key={label} className="px-6 py-4">
                  <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{label}</p>
                  <p className={`text-2xl sm:text-3xl font-bold mt-1 tracking-tight truncate ${colored !== undefined && colored !== null ? (colored >= 60 ? "text-emerald-600" : colored >= 35 ? "text-amber-600" : "text-red-600") : "text-slate-900"}`}>
                    {count !== null && count !== undefined ? <CountUp value={count} suffix={suffix} /> : value}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bento Layout Grid */}
        <div className="grid grid-cols-12 gap-6">

          {/* Left Column: List + Chart. order-2 on mobile so the audit form leads. */}
          <div className="col-span-12 lg:col-span-8 space-y-6 order-2 lg:order-1">
            
            {/* Brands List / Visual onboarding card */}
            {loading ? (
              <div className="card overflow-hidden">
                <div className="p-6 border-b border-slate-100">
                  <div className="h-5 w-40 rounded bg-slate-200 animate-pulse" />
                  <div className="h-3 w-56 rounded bg-slate-100 animate-pulse mt-2" />
                </div>
                <div className="divide-y divide-slate-50">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="grid grid-cols-12 px-6 py-3.5 items-center">
                      <div className="col-span-1"><div className="h-4 w-4 rounded bg-slate-200 animate-pulse" /></div>
                      <div className="col-span-5 flex items-center gap-3">
                        <div className="w-7 h-7 rounded-md bg-slate-200 animate-pulse" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-24 rounded bg-slate-200 animate-pulse" />
                          <div className="h-2.5 w-16 rounded bg-slate-100 animate-pulse" />
                        </div>
                      </div>
                      <div className="col-span-2 flex justify-end"><div className="h-6 w-12 rounded-lg bg-slate-100 animate-pulse" /></div>
                      <div className="col-span-2 flex justify-end"><div className="h-6 w-10 rounded-lg bg-slate-100 animate-pulse" /></div>
                      <div className="col-span-2 flex justify-end"><div className="h-4 w-6 rounded bg-slate-100 animate-pulse" /></div>
                    </div>
                  ))}
                </div>
              </div>
            ) : audited.length === 0 ? (
              /* Beautiful Visual Onboarding Step Diagram for New Users */
              <div className="card p-8 space-y-8">
                <div className="text-center max-w-lg mx-auto space-y-2.5">
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent-dim)] text-[var(--accent-2)]">
                    How Aura works
                  </span>
                  <h3 className="text-xl font-bold text-slate-900 tracking-tight">Audit Your Brand's Mentions Across Top AI Models</h3>
                  <p className="text-slate-500 text-xs leading-relaxed font-semibold">
                    Aura runs about 10 industry-specific buyer questions across four model families to check whether your brand gets recommended.
                  </p>
                </div>

                {/* Workflow Diagram */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
                  {[
                    { step: "01", title: "Configure", desc: "Add your brand name and domain in the sidebar." },
                    { step: "02", title: "Probing", desc: "Aura generates 10 search-intent prompt questions." },
                    { step: "03", title: "Evaluate", desc: "Bedrock agents query multiple models in parallel." },
                    { step: "04", title: "Analyze", desc: "Calculate visibility indexes and surface the exact gaps." }
                  ].map((s, idx) => (
                    <div key={idx} className="relative bg-slate-50 p-4.5 rounded-xl border border-slate-200 flex flex-col gap-2">
                      {idx < 3 && (
                        <div className="hidden md:block absolute top-1/2 -right-2.5 -translate-y-1/2 z-10 w-5 h-0.5 bg-slate-300" />
                      )}
                      <span className="text-[var(--accent-2)] font-extrabold text-[10px] tabular mono uppercase">{s.step}</span>
                      <p className="font-extrabold text-sm text-slate-800">{s.title}</p>
                      <p className="text-slate-500 text-[11px] leading-normal font-semibold">{s.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="text-center text-slate-500 text-xs font-semibold pt-1">
                  Ready to test? Add your brand details in the <span className="text-[var(--accent-2)] font-bold">Audit a Brand</span> panel to trigger your first run.
                </div>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="font-bold text-lg text-slate-900">Tracked Brands</h2>
                    <p className="text-slate-500 text-xs mt-0.5 font-semibold">
                      Monitor visibility indexes across LLMs
                      {hasDismissedDemos && (
                        <button onClick={restoreDemos} className="ml-2 text-[var(--accent)] font-bold hover:underline">
                          · Restore demo brands
                        </button>
                      )}
                    </p>
                  </div>
                  {/* Search / actions bar */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex">
                      <Search className="absolute left-3 top-0 bottom-0 my-auto w-4 h-4 text-slate-400 pointer-events-none z-10" />
                      <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search..."
                        style={{ paddingLeft: "2.25rem" }}
                        className="w-full sm:w-48 input-field py-2 text-xs"
                        aria-label="Search brand names"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Link href="/compare"
                        className="btn-ghost flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold">
                        <GitCompare className="w-3.5 h-3.5 text-[var(--accent)]" /> Compare
                      </Link>
                      <button onClick={() => exportPDF(audited)}
                        className="btn-ghost flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold"
                        aria-label="Export audited brands as PDF">
                        <Download className="w-3.5 h-3.5 text-[var(--accent)]" /> Export PDF
                      </button>
                    </div>
                  </div>
                </div>
 
                {/* Table header */}
                <div className="grid grid-cols-12 px-4 sm:px-6 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100 bg-slate-50/80">
                  <div className="col-span-1">#</div>
                  <div className="col-span-7 sm:col-span-5">Brand</div>
                  <div className="col-span-2 sm:col-span-2 text-right">Score</div>
                  <div className="hidden sm:block col-span-2 text-right">Trend</div>
                  <div className="col-span-2 flex items-center justify-end">
                    <span className="hidden sm:inline w-7 text-right cursor-help" title="Number of buyer-style questions asked across AI models in the latest audit">Probes</span>
                    <span className="hidden sm:block w-16" />
                  </div>
                </div>

                {search && filtered.filter(b => b.visibility_pct !== null).length === 0 && (
                  <div className="px-6 py-10 text-center">
                    <p className="text-slate-500 text-sm font-semibold">No brands match “{search}”.</p>
                    <button onClick={() => setSearch("")} className="text-[var(--accent)] text-xs font-bold mt-1.5 hover:underline">Clear search</button>
                  </div>
                )}

                <div className="divide-y divide-slate-50">
                  {filtered.filter(b => b.visibility_pct !== null).map((b, i) => (
                    <Link key={b.id} href={`/brands/${b.id}`} className="block">
                      <div className="group grid grid-cols-12 px-4 sm:px-6 py-3.5 items-center min-h-[60px] hover:bg-slate-50/70 transition-colors cursor-pointer">
                        <div className="col-span-1 flex items-center">
                          {i === 0 ? (
                            <Trophy className="w-3.5 h-3.5 text-amber-400" />
                          ) : (
                            <span className="text-xs font-semibold text-slate-400 tabular">{i + 1}</span>
                          )}
                        </div>
                        <div className="col-span-7 sm:col-span-5 flex items-center gap-3 min-w-0">
                          <div className="relative w-7 h-7 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            <span className="text-[10px] font-bold text-slate-600 uppercase">{b.name.slice(0, 2)}</span>
                            {b.domain && (
                              // Favicon over the monogram; hides itself on load error to reveal the monogram.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`https://www.google.com/s2/favicons?domain=${b.domain}&sz=64`}
                                alt=""
                                className="absolute inset-0 w-full h-full object-contain bg-white"
                                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-slate-800 group-hover:text-[var(--accent)] transition-colors flex items-center gap-1.5 truncate">
                              <span className="truncate">{b.name}</span>
                              <ChevronRight className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                            </p>
                            {b.industry && (
                              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">{b.industry.split("/")[0].trim()}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="col-span-2 flex justify-end"><ScoreChip pct={b.visibility_pct} /></div>
                        <div className="hidden sm:flex col-span-2 justify-end"><TrendPill v={b.trend} /></div>
                        <div className="col-span-2 flex items-center justify-end gap-1">
                          {/* Probe count: hidden on mobile (no room), shown sm+. */}
                          <span className="hidden sm:inline text-slate-700 text-sm font-semibold tabular w-7 text-right">{b.probe_count ?? "0"}</span>
                          {/* Action buttons: hover-reveal on desktop (group-hover), but ALWAYS
                              visible on mobile/touch — phones have no hover, so a hover-gated
                              button would be invisible/unusable. */}
                          <div className="flex items-center justify-end gap-0.5 sm:w-16">
                          {/* Re-run audit: desktop-only (mobile keeps the row uncluttered;
                              users can re-run from the brand page). hover-reveal on desktop. */}
                          {!b.is_example && (
                            <button onClick={e => { e.preventDefault(); window.location.href = `/brands/${b.id}?autostart=1`; }}
                              className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center text-slate-400 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-all sm:opacity-0 sm:group-hover:opacity-100"
                              title="Re-run audit"
                              aria-label={`Re-run audit for ${b.name}`}>
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {/* Delete/hide: always visible on mobile (no hover on touch),
                              hover-reveal on desktop. */}
                          <button onClick={e => { e.preventDefault(); deleteBrand(b.id); }}
                            disabled={deleting === b.id}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all sm:opacity-0 sm:group-hover:opacity-100"
                            title={b.is_example ? "Hide this demo brand from your dashboard" : "Delete brand"}
                            aria-label={b.is_example ? `Hide demo brand ${b.name}` : `Delete ${b.name}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Race chart Card */}
            {audited.length > 1 && (
              <div className="card p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="font-bold text-lg text-slate-900">Competitive Race</h2>
                    <p className="text-slate-500 text-xs mt-0.5 font-semibold">Comparative brand representation index</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 font-semibold">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Strong</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Moderate</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Weak</span>
                  </div>
                </div>
                <ComparisonChart brands={audited} />
              </div>
            )}
          </div>

          {/* Right Column: Sidebar. order-1 on mobile so the form is the first thing acted on. */}
          <div className="col-span-12 lg:col-span-4 space-y-6 order-1 lg:order-2">

            {/* Add Brand Form Card — accent border to draw the eye */}
            <div id="audit-form" className="card-cta p-5 scroll-mt-20">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-md bg-[var(--accent-dim)] flex items-center justify-center">
                  <Building2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                </div>
                <h2 className="text-slate-900 font-bold text-sm">Audit a Brand</h2>
              </div>
              <p className="text-slate-400 text-xs mb-4 pl-8">Add any brand to measure its AI visibility across models.</p>

              {limitReached && !admin && (
                <div className="border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold p-3 rounded-xl flex flex-col gap-1 mb-4 leading-relaxed">
                  <span className="font-extrabold uppercase text-[10px] tracking-wider">Audit Limit Reached</span>
                  You&apos;ve reached the free audit limit (2 audits). Please check back later.
                </div>
              )}

              <form onSubmit={addBrand} className="space-y-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="brand-name" className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Brand Name</label>
                  <input id="brand-name" value={name} onChange={e => setName(e.target.value)}
                    placeholder="e.g. Salesforce, Rippling, Notion"
                    className="w-full input-field py-2.5 text-sm"
                    aria-label="Brand name"
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="brand-domain" className="text-slate-500 text-[10px] uppercase font-bold tracking-wider flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Domain <span className="normal-case text-slate-300 font-normal">(optional)</span>
                  </label>
                  <input id="brand-domain" value={domain} onChange={e => setDomain(e.target.value)}
                    placeholder="e.g. salesforce.com"
                    className="w-full input-field py-2.5 text-sm"
                    aria-label="Brand domain"
                    autoComplete="off"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="brand-industry" className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">
                    Industry <span className="normal-case text-slate-300 font-normal">(sharpens probe questions)</span>
                  </label>
                  {industryOther ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={industry}
                        onChange={e => setIndustry(e.target.value)}
                        placeholder="Type your industry"
                        className="w-full input-field py-2.5 text-sm pr-16"
                        aria-label="Custom industry"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => { setIndustryOther(false); setIndustry(""); }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400 hover:text-[var(--accent)]"
                      >
                        List
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        id="brand-industry"
                        value={industry}
                        onChange={e => {
                          if (e.target.value === "__other__") { setIndustryOther(true); setIndustry(""); }
                          else setIndustry(e.target.value);
                        }}
                        className="w-full input-field py-2.5 text-sm appearance-none pr-8"
                      >
                        <option value="">Select industry</option>
                        {industries.map(ind => (
                          <option key={ind} value={ind}>{ind}</option>
                        ))}
                        <option value="__other__">Other (type your own)</option>
                      </select>
                      <ChevronDown className="absolute right-2.5 top-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowCustom(v => !v)}
                    className="text-[11px] text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-1 transition-colors self-start"
                  >
                    <Plus className="w-3 h-3" />
                    Add your own questions <span className="text-slate-300 font-normal">(optional)</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${showCustom ? "rotate-180" : ""}`} />
                  </button>
                  {showCustom && (
                    <textarea
                      value={customText}
                      onChange={e => setCustomText(e.target.value)}
                      placeholder={"Does it integrate with Slack?\nWhich tool is best for small teams?"}
                      className="w-full input-field py-2.5 text-sm leading-relaxed resize-none"
                      rows={3}
                    />
                  )}
                </div>

                {formError && (
                  <p role="alert" className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {formError}
                  </p>
                )}

                <button type="submit" disabled={adding || !name.trim() || (limitReached && !admin)}
                  className="w-full btn-primary flex items-center justify-center gap-1.5 py-2.5 mt-1"
                >
                  <Plus className="w-4 h-4 text-white" />
                  {adding ? "Running Audit..." : (limitReached && !admin) ? "Limit Reached" : "Add & Run Audit"}
                </button>
              </form>
            </div>

            {/* Audits running right now — these are NOT "unaudited", they're mid-run. */}
            {inProgress.length > 0 && (
              <div className="card p-6 space-y-4">
                <div>
                  <h2 className="text-slate-900 font-bold text-sm flex items-center gap-2">
                    <span className="live-dot" /> Audit in progress
                  </h2>
                  <p className="text-slate-500 text-xs mt-0.5 font-semibold">Running across 4 AI models — this finishes on its own</p>
                </div>
                <div className="flex flex-col gap-2.5">
                  {inProgress.map(b => (
                    <Link key={b.id} href={`/brands/${b.id}`} className="block">
                      <div className="flex items-center justify-between p-3.5 rounded-xl border border-[var(--accent)]/30 transition-all cursor-pointer" style={{ background: "var(--accent-dim)" }}>
                        <span className="text-slate-800 text-sm font-bold truncate max-w-32 flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 text-[var(--accent)] animate-spin flex-shrink-0" />
                          {b.name}
                        </span>
                        <span className="text-[var(--accent-2)] text-xs font-bold flex items-center gap-1">
                          Auditing… <ArrowRight className="w-3.5 h-3.5 text-[var(--accent-2)]" />
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Pending / Unaudited Brands list */}
            {pending.length > 0 && (
              <div className="card p-6 space-y-4">
                <div>
                  <h2 className="text-slate-900 font-bold text-sm">Unaudited Brands</h2>
                  <p className="text-slate-500 text-xs mt-0.5 font-semibold">Runs queued or waiting for execution</p>
                </div>
                <div className="flex flex-col gap-2.5">
                  {pending.map(b => (
                    <div key={b.id} className="relative group">
                      <Link href={`/brands/${b.id}`} className="block">
                        <div className="flex items-center justify-between p-3.5 pr-14 rounded-xl border border-dashed border-slate-300 hover:border-[var(--accent)]/40 hover:bg-[var(--accent-dim)] transition-all cursor-pointer">
                          <span className="text-slate-700 text-sm font-bold truncate max-w-28">{b.name}</span>
                          <span className="text-[var(--accent-2)] text-xs font-bold flex items-center gap-1">
                            Run Audit <ArrowRight className="w-3.5 h-3.5 text-[var(--accent-2)]" />
                          </span>
                        </div>
                      </Link>
                      {/* Delete Button for pending brands */}
                      <button
                        onClick={e => { e.preventDefault(); e.stopPropagation(); deleteBrand(b.id); }}
                        disabled={deleting === b.id}
                        className="absolute right-2.5 top-2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
                        title="Delete brand"
                        aria-label={`Delete ${b.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* How it works — methodology / trust layer */}
        <Reveal>
          <section className="card p-6 sm:p-8">
            <h2 className="font-bold text-lg text-slate-900 text-center">How Aura measures AI visibility</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-6">
              {[
                { step: "1", title: "Real buyer questions", desc: "We generate about 10 questions a real buyer would ask an AI about your category, not generic prompts." },
                { step: "2", title: "Four AI models", desc: "Each question runs across four model families in parallel." },
                { step: "3", title: "A visibility score", desc: "We measure how often your brand gets mentioned, then show where you're strong and where you're invisible." },
              ].map((s, i) => (
                <Reveal key={s.step} delay={i * 120}>
                  <div className="text-center space-y-2">
                    <div className="w-8 h-8 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] font-bold text-sm flex items-center justify-center mx-auto">{s.step}</div>
                    <p className="font-bold text-sm text-slate-800">{s.title}</p>
                    <p className="text-slate-500 text-xs font-medium leading-relaxed">{s.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        </Reveal>
      </div>

      <footer className="border-t mt-8 py-6 px-6 text-center" style={{ borderColor: "var(--border-solid)" }}>
        <p className="text-xs text-slate-400 font-medium">
          <span className="font-bold text-slate-500">Aura AI</span> · AI brand visibility analytics ·
          Results reflect non-deterministic AI responses and may vary between runs.
        </p>
      </footer>
    </main>
  );
}
