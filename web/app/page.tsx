"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import ComparisonChart from "./components/ComparisonChart";
import { getSessionId } from "./lib/session";
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
  RefreshCw
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function exportCSV(brands: BrandRow[]) {
  const rows = [
    ["Brand", "Domain", "AI Visibility %", "vs Last Run", "Probes", "Last Audit"],
    ...brands.map(b => [
      b.name,
      b.domain ?? "",
      b.visibility_pct?.toFixed(1) ?? "",
      b.trend !== null ? `${b.trend > 0 ? "+" : ""}${b.trend?.toFixed(1)}%` : "",
      b.probe_count ?? "",
      b.last_run ? new Date(b.last_run).toLocaleDateString() : "",
    ])
  ];
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ai-visibility-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
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

function TrendPill({ v }: { v: number | null }) {
  if (v === null || v === 0) return <span className="text-slate-400 text-xs font-semibold px-2 py-1 bg-slate-100 rounded-lg border border-slate-200">—</span>;
  const up = v > 0;
  return (
    <span className={`text-xs font-semibold px-2 py-1 rounded-lg flex items-center gap-1 w-fit ${up ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
      {up ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%
    </span>
  );
}

export default function Home() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [auditCount, setAuditCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sess = getSessionId();
      const [compareRes, limitRes, industriesRes] = await Promise.all([
        fetch(`${API}/brands/compare?session_id=${sess}`),
        fetch(`${API}/audit/limit-status?session_id=${sess}`),
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
    load();
  }, [load]);

  async function addBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`${API}/brands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          domain: domain.trim() || null,
          industry: industry || null,
          session_id: getSessionId()
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail?.[0]?.msg ?? err.detail ?? "Failed to create brand. Please try again.");
        return;
      }
      const brand = await res.json();
      window.location.href = `/brands/${brand.id}?autostart=1`;
    } catch {
      alert("Network error. Please check your connection and try again.");
    } finally {
      setAdding(false);
    }
  }

  async function deleteBrand(id: number) {
    const targetBrand = brands.find(b => b.id === id);
    if (targetBrand?.is_example) return;
    if (!confirm("Delete this brand and all its data?")) return;
    setDeleting(id);
    const sess = getSessionId();
    const res = await fetch(`${API}/brands/${id}?session_id=${sess}`, { method: "DELETE" });
    if (res.status === 403) alert("You can only delete brands you added.");
    setDeleting(null);
    load();
  }

  const filtered = search
    ? brands.filter(b => b.name.toLowerCase().includes(search.toLowerCase()))
    : brands;
  const audited = filtered.filter(b => b.visibility_pct !== null);
  const allAudited = brands.filter(b => b.visibility_pct !== null);
  const sortedAudited = [...allAudited].sort((a, b) => (b.visibility_pct ?? 0) - (a.visibility_pct ?? 0));
  const avg = allAudited.length ? allAudited.reduce((s, b) => s + (b.visibility_pct ?? 0), 0) / allAudited.length : null;
  const best = sortedAudited[0] ?? null;
  const pending = filtered.filter(b => b.visibility_pct === null);

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Top nav */}
      <header className="border-b px-8 py-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md" style={{ borderColor: "var(--border-solid)", background: "rgba(255,255,255,0.95)" }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--accent)] shadow-md shadow-[var(--accent-glow)] select-none">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm text-slate-900 tracking-tight">Aura AI — Visibility Engine</span>
        </div>
        <span className="text-slate-500 text-xs font-semibold tabular border border-slate-200 bg-slate-50 px-3 py-1.5 rounded-xl select-none">
          {2 - auditCount} / 2 Audits Available
        </span>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        {/* KPI strip — single card, connected */}
        {audited.length > 0 && (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-slate-100">
              {[
                { label: "Brands Tracked", value: brands.length.toString(), sub: `${audited.length} audited` },
                { label: "Avg AI Visibility", value: avg !== null ? `${avg.toFixed(0)}%` : "—", sub: "across all brands", colored: avg },
                { label: "Market Leader", value: best?.name ?? "—", sub: best ? `${best.visibility_pct?.toFixed(0)}% visibility` : "", colored: best?.visibility_pct },
              ].map(({ label, value, sub, colored }) => (
                <div key={label} className="px-6 py-4">
                  <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{label}</p>
                  <p className={`text-3xl font-bold mt-1 tracking-tight ${colored !== undefined && colored !== null ? (colored >= 60 ? "text-emerald-600" : colored >= 35 ? "text-amber-600" : "text-red-600") : "text-slate-900"}`}>
                    {value}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bento Layout Grid */}
        <div className="grid grid-cols-12 gap-6">
          
          {/* Left Column: List + Chart (col-span-12 lg:col-span-8) */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            
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
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-700">
                    How Aura works
                  </span>
                  <h3 className="text-xl font-bold text-slate-900 tracking-tight">Audit Your Brand's Mentions Across Top AI Models</h3>
                  <p className="text-slate-500 text-xs leading-relaxed font-semibold">
                    Aura AI uses AWS Bedrock to probe search assistant models (Nova, Claude, Llama) with ~10 industry-specific probe questions to check if your brand is recommended.
                  </p>
                </div>

                {/* Workflow Diagram */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
                  {[
                    { step: "01", title: "Configure", desc: "Add your brand name and domain in the sidebar." },
                    { step: "02", title: "Probing", desc: "Aura generates 10 search-intent prompt questions." },
                    { step: "03", title: "Evaluate", desc: "Bedrock agents query multiple models in parallel." },
                    { step: "04", title: "Analyze", desc: "Calculate visibility indexes & get improvement plans." }
                  ].map((s, idx) => (
                    <div key={idx} className="relative bg-slate-50 p-4.5 rounded-xl border border-slate-200 flex flex-col gap-2">
                      {idx < 3 && (
                        <div className="hidden md:block absolute top-1/2 -right-2.5 -translate-y-1/2 z-10 w-5 h-0.5 bg-slate-300" />
                      )}
                      <span className="text-sky-700 font-extrabold text-[10px] tabular mono uppercase">{s.step}</span>
                      <p className="font-extrabold text-sm text-slate-800">{s.title}</p>
                      <p className="text-slate-500 text-[11px] leading-normal font-semibold">{s.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="text-center text-slate-500 text-xs font-semibold pt-1">
                  Ready to test? Add your brand details in the <span className="text-sky-700 font-bold">Audit a Brand</span> panel to trigger your first run.
                </div>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="font-bold text-lg text-slate-900">Tracked Brands</h2>
                    <p className="text-slate-500 text-xs mt-0.5 font-semibold">Monitor visibility indexes across LLMs</p>
                  </div>
                  {/* Search / actions bar */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                      <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search..."
                        className="w-full sm:w-48 input-field pl-9 py-2 text-xs"
                        aria-label="Search brand names"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Link href="/compare"
                        className="btn-ghost flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold">
                        <GitCompare className="w-3.5 h-3.5 text-[var(--accent)]" /> Compare
                      </Link>
                      <button onClick={() => exportCSV(audited)}
                        className="btn-ghost flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold"
                        aria-label="Export audited brands as CSV">
                        <Download className="w-3.5 h-3.5 text-[var(--accent)]" /> Export
                      </button>
                    </div>
                  </div>
                </div>
 
                {/* Table header */}
                <div className="grid grid-cols-12 px-6 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100 bg-slate-50/80">
                  <div className="col-span-1">#</div>
                  <div className="col-span-5">Brand</div>
                  <div className="col-span-2 text-right">Score</div>
                  <div className="col-span-2 text-right">Trend</div>
                  <div className="col-span-2 text-right">Probes</div>
                </div>

                <div className="divide-y divide-slate-50">
                  {filtered.filter(b => b.visibility_pct !== null).map((b, i) => (
                    <Link key={b.id} href={`/brands/${b.id}`} className="block">
                      <div className="group grid grid-cols-12 px-6 py-3.5 items-center hover:bg-slate-50/70 transition-colors cursor-pointer">
                        <div className="col-span-1 flex items-center">
                          {i === 0 ? (
                            <Trophy className="w-3.5 h-3.5 text-amber-400" />
                          ) : (
                            <span className="text-xs font-semibold text-slate-400 tabular">{i + 1}</span>
                          )}
                        </div>
                        <div className="col-span-5 flex items-center gap-3">
                          <div className="w-7 h-7 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-slate-600 uppercase">{b.name.slice(0, 2)}</span>
                          </div>
                          <div>
                            <p className="font-semibold text-sm text-slate-800 group-hover:text-[var(--accent)] transition-colors flex items-center gap-1">
                              {b.name}
                              <ChevronRight className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {b.domain && <p className="text-[11px] text-slate-400 font-medium">{b.domain}</p>}
                              {b.industry && <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">{b.industry.split("/")[0].trim()}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="col-span-2 text-right"><ScoreChip pct={b.visibility_pct} /></div>
                        <div className="col-span-2 text-right flex justify-end"><TrendPill v={b.trend} /></div>
                        <div className="col-span-2 text-right flex items-center justify-end gap-1">
                          <span className="text-slate-700 text-sm font-semibold tabular">{b.probe_count ?? "—"}</span>
                          {!b.is_example && (
                            <button onClick={e => { e.preventDefault(); window.location.href = `/brands/${b.id}?autostart=1`; }}
                              className="ml-1 w-7 h-7 rounded flex items-center justify-center text-slate-300 hover:text-[var(--accent)] hover:bg-sky-50 transition-all opacity-0 group-hover:opacity-100"
                              title="Re-run audit"
                              aria-label={`Re-run audit for ${b.name}`}>
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {b.is_example ? (
                            <span title="Example brands are read-only" className="ml-1 w-7 h-7 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-not-allowed">
                              <Trash2 className="w-3.5 h-3.5 text-slate-200" />
                            </span>
                          ) : (
                            <button onClick={e => { e.preventDefault(); deleteBrand(b.id); }}
                              disabled={deleting === b.id}
                              className="ml-1 w-7 h-7 rounded flex items-center justify-center text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                              title="Delete brand"
                              aria-label={`Delete ${b.name}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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

          {/* Right Column: Sidebar (col-span-12 lg:col-span-4) */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            
            {/* Add Brand Form Card — accent border to draw the eye */}
            <div className="card-cta p-5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-md bg-[var(--accent-dim)] flex items-center justify-center">
                  <Building2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                </div>
                <h2 className="text-slate-900 font-bold text-sm">Audit a Brand</h2>
              </div>
              <p className="text-slate-400 text-xs mb-4 pl-8">Add any brand to measure its AI visibility across models.</p>

              {limitReached && (
                <div className="border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold p-3 rounded-xl flex flex-col gap-1 mb-4 leading-relaxed">
                  <span className="font-extrabold uppercase text-[10px] tracking-wider">Audit Limit Reached</span>
                  You&apos;ve used both free audits. Try again later or from a different network.
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
                  <div className="relative">
                    <select
                      id="brand-industry"
                      value={industry}
                      onChange={e => setIndustry(e.target.value)}
                      className="w-full input-field py-2.5 text-sm appearance-none pr-8"
                    >
                      <option value="">Select industry…</option>
                      {industries.map(ind => (
                        <option key={ind} value={ind}>{ind}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <button type="submit" disabled={adding || !name.trim() || limitReached}
                  className="w-full btn-primary flex items-center justify-center gap-1.5 py-2.5 mt-1"
                >
                  <Plus className="w-4 h-4 text-white" />
                  {adding ? "Running Audit..." : limitReached ? "Limit Reached" : "Add & Run Audit"}
                </button>
              </form>
            </div>

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
                        <div className="flex items-center justify-between p-3.5 pr-14 rounded-xl border border-dashed border-slate-300 hover:border-sky-300 hover:bg-sky-50 transition-all cursor-pointer">
                          <span className="text-slate-700 text-sm font-bold truncate max-w-28">{b.name}</span>
                          <span className="text-sky-700 text-xs font-bold flex items-center gap-1">
                            Run Audit <ArrowRight className="w-3.5 h-3.5 text-sky-700" />
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
      </div>
    </main>
  );
}
