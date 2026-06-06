"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import AuditButton from "./AuditButton";
import DeleteInsightButton from "./DeleteInsightButton";
import ProbeDetail from "./ProbeDetail";
import ScoreRing from "./ScoreRing";
import VisibilityChart from "./VisibilityChart";
import ModelGrid from "../../components/ModelGrid";
import { getSessionId, getAdminKey } from "../../lib/session";
import { ArrowLeft, Info, ArrowUp, ArrowDown, ChevronDown, Sparkles } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Brand = { id: number; name: string; domain: string | null; industry: string | null; session_id?: string | null; is_example?: boolean };

function apiHeaders(): Record<string, string> {
  const sess = getSessionId();
  const h: Record<string, string> = {};
  if (sess === "admin") h["X-Admin-Key"] = getAdminKey();
  return h;
}

function sessQs() {
  return `session_id=${encodeURIComponent(getSessionId())}`;
}

function summaryToBullets(summary: string): string[] {
  return summary.split(/\.\s+/).filter(s => s.length > 20 && s.length < 120).slice(0, 3).map(s => s.trim().replace(/\.$/, ""));
}

export default function BrandPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = String(params.id);
  const autostart = searchParams.get("autostart");

  const [brand, setBrand] = useState<Brand | null>(null);
  const [insights, setInsights] = useState<any[]>([]);
  const [modelBias, setModelBias] = useState<{ models: any[] }>({ models: [] });
  const [probePerf, setProbePerf] = useState<{ top: any[]; bottom: any[] }>({ top: [], bottom: [] });
  const [compare, setCompare] = useState<any[]>([]);
  const [probeDetail, setProbeDetail] = useState<{ probes: any[]; audit_date: string | null }>({ probes: [], audit_date: null });
  const [darkMatter, setDarkMatter] = useState<any>({ dark_matter_count: 0, total_probes: 0, probes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = sessQs();
    const hdrs = apiHeaders();
    try {
      const [brandRes, insightsRes, biasRes, perfRes, compareRes, detailRes, darkRes] = await Promise.all([
        fetch(`${API}/brands/${id}?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/insights?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/model-bias?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/probe-performance?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/compare?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/probe-detail?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/dark-matter?${qs}`, { headers: hdrs }),
      ]);
      if (brandRes.status === 403) { setError("You do not have access to this brand."); return; }
      if (brandRes.status === 404) { setError("Brand not found."); return; }
      if (!brandRes.ok) { setError("Failed to load brand."); return; }
      setBrand(await brandRes.json());
      if (insightsRes.ok) setInsights(await insightsRes.json());
      if (biasRes.ok) setModelBias(await biasRes.json());
      if (perfRes.ok) setProbePerf(await perfRes.json());
      if (compareRes.ok) setCompare(await compareRes.json());
      if (detailRes.ok) setProbeDetail(await detailRes.json());
      if (darkRes.ok) setDarkMatter(await darkRes.json());
    } catch {
      setError("Network error loading brand data.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <p className="text-slate-400 text-sm font-semibold">Loading brand data…</p>
      </main>
    );
  }

  if (error || !brand) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: "var(--bg)" }}>
        <p className="text-slate-700 font-bold">{error ?? "Brand not found."}</p>
        <Link href="/" className="btn-ghost text-sm">← Back to Dashboard</Link>
      </main>
    );
  }

  const rankData = compare.find((b: { id: number }) => b.id === Number(id));
  const rank = rankData?.rank ?? null;
  const totalBrands = compare.filter((b: { visibility_pct: number | null }) => b.visibility_pct !== null).length;
  const latest = insights[0] ?? null;
  const previous = insights[1] ?? null;
  const trend = latest && previous ? latest.visibility_pct - previous.visibility_pct : null;
  const chartData = [...insights].reverse().map((ins: { visibility_pct: number; created_at: string }) => ({
    label: new Date(ins.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    visibility: ins.visibility_pct ?? 0,
  }));

  return (
    <main className="min-h-screen animate-fade-in" style={{ background: "var(--bg)" }}>
      <header className="border-b px-8 py-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md"
        style={{ borderColor: "var(--border-solid)", background: "rgba(255,255,255,0.92)" }}>
        <div className="flex items-center gap-4">
          <Link href="/" className="btn-ghost py-1.5 px-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 font-semibold">
            <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
          </Link>
          <div className="w-px h-4 bg-slate-200" />
          <h1 className="font-bold text-base text-slate-900 tracking-tight">{brand.name}</h1>
          {brand.domain && <span className="text-slate-400 text-sm font-semibold">{brand.domain}</span>}
        </div>
        <AuditButton brandId={Number(id)} />
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {!latest ? (
          <div className="card p-16 text-center" style={{ borderStyle: "dashed" }}>
            {autostart === "1" ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-2">
                  <span className="live-dot" />
                  <p className="text-slate-900 font-bold text-lg">Audit starting…</p>
                </div>
                <p className="text-slate-500 text-sm font-semibold max-w-lg mx-auto">
                  Generating industry-specific probe questions and querying AI models. Live progress is in the top-right. This page refreshes when done (~1–2 min).
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-slate-800 font-bold text-lg">No audits executed yet</p>
                <p className="text-slate-500 text-sm font-semibold">Click &quot;Run Audit&quot; above to measure how visible {brand.name} is across AI models.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="card p-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                <ScoreRing pct={latest.visibility_pct ?? 0} rank={rank} total={totalBrands > 1 ? totalBrands : undefined} />
                {trend !== null && (
                  <div className={`text-center px-5 py-3.5 rounded-2xl border flex flex-col items-center justify-center min-w-36 cursor-help ${trend > 0 ? "border-emerald-200 bg-emerald-50" : trend < 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}
                    title="Scores vary between audits: AI responses are non-deterministic, each run uses fresh probe questions, and failed models are excluded from the score.">
                    <p className={`text-3xl font-extrabold tabular ${trend > 0 ? "text-emerald-600" : trend < 0 ? "text-red-600" : "text-slate-400"}`}>
                      {trend > 0 ? "+" : ""}{trend.toFixed(1)}%
                    </p>
                    <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider mt-1.5 flex items-center gap-1">
                      vs last run <Info className="w-3.5 h-3.5 text-slate-400" />
                    </span>
                  </div>
                )}
              </div>
            </div>

            {(() => {
              const findings = latest.key_findings?.length > 0 ? latest.key_findings : summaryToBullets(latest.summary);
              const hasRecs = latest.recommendations?.length > 0;
              return (findings.length > 0 || hasRecs) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {findings.length > 0 && (
                    <div className="card p-6">
                      <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-4">Key Findings</p>
                      <div className="space-y-4">
                        {findings.map((f: string, i: number) => {
                          const bad = /0%|drops|invisible|weak/i.test(f);
                          return (
                            <div key={i} className="flex items-start gap-2.5">
                              {bad ? <ArrowDown className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500 bg-red-50 p-0.5 rounded" />
                                     : <ArrowUp className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600 bg-emerald-50 p-0.5 rounded" />}
                              <p className="text-sm text-slate-700 leading-relaxed font-semibold">{f}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {hasRecs && (
                    <div className="card p-6" style={{ background: "var(--accent-dim)", borderColor: "var(--border-2)" }}>
                      <p className="text-[10px] uppercase font-bold tracking-wider mb-4 text-[var(--accent)]">Action Plan</p>
                      <div className="space-y-4">
                        {latest.recommendations.map((r: string, i: number) => (
                          <div key={i} className="flex items-start gap-2.5">
                            <Sparkles className="w-4 h-4 mt-0.5 text-[var(--accent)] flex-shrink-0" />
                            <p className="text-sm text-slate-700 leading-relaxed font-semibold">{r}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {modelBias.models?.length > 0 && (
              <div className="card p-6">
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-5">Model Breakdown</p>
                <ModelGrid models={modelBias.models} />
              </div>
            )}

            {(probePerf.top?.length > 0 || probePerf.bottom?.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="card p-6">
                  <p className="text-emerald-600 text-[10px] uppercase font-bold tracking-wider mb-4">Strongest Queries</p>
                  <div className="space-y-4">
                    {probePerf.top.map(({ prompt, hit_rate }: { prompt: string; hit_rate: number }) => (
                      <div key={prompt}>
                        <div className="flex justify-between gap-2 mb-1.5">
                          <p className="text-xs text-slate-600 flex-1 font-semibold">{prompt}</p>
                          <span className="text-emerald-700 text-xs font-bold tabular">{hit_rate}%</span>
                        </div>
                        <div className="w-full rounded-full h-1.5 bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${hit_rate}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card p-6">
                  <p className="text-red-500 text-[10px] uppercase font-bold tracking-wider mb-4">Visibility Gaps</p>
                  <div className="space-y-4">
                    {probePerf.bottom.map(({ prompt, hit_rate }: { prompt: string; hit_rate: number }) => (
                      <div key={prompt}>
                        <div className="flex justify-between gap-2 mb-1.5">
                          <p className="text-xs text-slate-600 flex-1 font-semibold">{prompt}</p>
                          <span className="text-red-600 text-xs font-bold tabular">{hit_rate}%</span>
                        </div>
                        <div className="w-full rounded-full h-1.5 bg-slate-100"><div className="h-full rounded-full bg-red-500" style={{ width: `${Math.max(hit_rate, 2)}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {chartData.length > 1 && (
              <div className="card p-6">
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-5">Visibility Over Time</p>
                <VisibilityChart data={chartData} />
              </div>
            )}

            {probeDetail.probes.length > 0 && (
              <ProbeDetail probes={probeDetail.probes} auditDate={probeDetail.audit_date} />
            )}

            {darkMatter.dark_matter_count > 0 && (
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-slate-800 font-bold text-sm">Dark Matter Queries</p>
                    <p className="text-slate-400 text-xs mt-0.5">Questions where no AI model mentions your brand</p>
                  </div>
                  <span className="text-xs font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                    {darkMatter.dark_matter_count} of {darkMatter.total_probes} probes
                  </span>
                </div>
                <div className="space-y-2.5">
                  {darkMatter.probes.map((p: { question: string; times_tested: number }, i: number) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-dashed border-slate-300 bg-white">
                      <span className="text-slate-300 font-bold text-xs tabular">{String(i + 1).padStart(2, "0")}</span>
                      <p className="text-sm text-slate-600 font-medium flex-1">{p.question}</p>
                      <span className="text-[10px] text-slate-400 font-semibold">0/{p.times_tested} models</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <details className="card overflow-hidden group">
              <summary className="px-6 py-4 cursor-pointer text-slate-600 text-sm font-bold flex items-center justify-between">
                <span>Audit history ({insights.length} run{insights.length !== 1 ? "s" : ""})</span>
                <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {insights.map((ins: any, i: number) => (
                  <div key={ins.id} className="px-6 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-extrabold text-sm text-slate-900 tabular">{ins.visibility_pct?.toFixed(1)}%</span>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 text-xs">{new Date(ins.created_at).toLocaleDateString()}</span>
                        <DeleteInsightButton brandId={Number(id)} insightId={ins.id} brandSessionId={brand.session_id} />
                      </div>
                    </div>
                    <p className="text-slate-500 text-sm font-semibold">{ins.summary}</p>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </main>
  );
}
