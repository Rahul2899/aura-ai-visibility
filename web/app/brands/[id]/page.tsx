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
import { ArrowLeft, Info, ArrowUp, ArrowDown, ChevronDown, Sparkles, Share2 } from "lucide-react";

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
  const [probeResponses, setProbeResponses] = useState<any[]>([]);
  const [darkMatter, setDarkMatter] = useState<any>({ dark_matter_count: 0, total_probes: 0, probes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareLabel, setShareLabel] = useState("Share");
  // True while an audit is actively running for this brand — detected from the
  // same localStorage job key AuditButton uses, so it works whether the audit was
  // triggered via autostart or the "Run Audit" button. Drives the centered progress UI.
  const [auditActive, setAuditActive] = useState(false);
  useEffect(() => {
    // Drive the centered progress panel off the live job key only. AuditButton
    // removes that key on completion OR failure, so this clears correctly. We must
    // NOT also key off `autostart` — that stays "1" for the page's lifetime and
    // would leave the "Auditing…" spinner stuck forever after a failed audit.
    // On a fresh autostart there's a brief gap before the key is written, so seed
    // it true once when autostart is set; the key takes over on the next tick.
    const check = () => setAuditActive(!!localStorage.getItem(`aura_audit_job_${id}`));
    if (autostart === "1") {
      setAuditActive(true);   // seed for the brief gap before AuditButton writes the key
    } else {
      check();
    }
    const iv = setInterval(check, 1500);
    return () => clearInterval(iv);
  }, [id, autostart]);

  async function shareReport() {
    try {
      const res = await fetch(`${API}/brands/${id}/share?${sessQs()}`, {
        method: "POST",
        headers: apiHeaders(),
      });
      if (!res.ok) { setShareLabel("Failed"); return; }
      const { token } = await res.json();
      const url = `${window.location.origin}/share/${token}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      setShareLabel("Link copied!");
      setTimeout(() => setShareLabel("Share"), 2500);
    } catch {
      setShareLabel("Failed");
      setTimeout(() => setShareLabel("Share"), 2500);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = sessQs();
    const hdrs = apiHeaders();
    try {
      const [brandRes, insightsRes, biasRes, perfRes, compareRes, detailRes, darkRes, respRes] = await Promise.all([
        fetch(`${API}/brands/${id}?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/insights?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/model-bias?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/probe-performance?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/compare?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/probe-detail?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/dark-matter?${qs}`, { headers: hdrs }),
        fetch(`${API}/brands/${id}/probe-responses?${qs}`, { headers: hdrs }),
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
      if (respRes.ok) { const d = await respRes.json(); setProbeResponses(Array.isArray(d.probes) ? d.probes : []); }
    } catch {
      setError("Network error loading brand data.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "var(--bg)" }}>
        <header className="border-b px-8 py-4 flex items-center justify-between" style={{ borderColor: "var(--border-solid)", background: "rgba(255,255,255,0.92)" }}>
          <div className="h-5 w-40 rounded bg-slate-200 animate-pulse" />
          <div className="h-9 w-28 rounded-lg bg-slate-200 animate-pulse" />
        </header>
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          <div className="card p-6">
            <div className="flex items-center gap-6">
              <div className="w-28 h-28 rounded-full bg-slate-200 animate-pulse" />
              <div className="flex-1 space-y-3">
                <div className="h-4 w-1/3 rounded bg-slate-200 animate-pulse" />
                <div className="h-4 w-1/2 rounded bg-slate-100 animate-pulse" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[0, 1].map(i => (
              <div key={i} className="card p-6 space-y-3">
                <div className="h-3 w-24 rounded bg-slate-200 animate-pulse" />
                <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
                <div className="h-4 w-5/6 rounded bg-slate-100 animate-pulse" />
                <div className="h-4 w-4/6 rounded bg-slate-100 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
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
      <header className="border-b px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between gap-2 sticky top-0 z-10 backdrop-blur-md"
        style={{ borderColor: "var(--border-solid)", background: "rgba(255,255,255,0.92)" }}>
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link href="/" className="btn-ghost py-1.5 px-2.5 sm:px-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 font-semibold flex-shrink-0">
            <ArrowLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <div className="w-px h-4 bg-slate-200 flex-shrink-0" />
          <div className="relative w-6 h-6 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
            <span className="text-[9px] font-bold text-slate-600 uppercase">{brand.name.slice(0, 2)}</span>
            {brand.domain && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`https://www.google.com/s2/favicons?domain=${brand.domain}&sz=64`} alt=""
                className="absolute inset-0 w-full h-full object-contain bg-white"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            )}
          </div>
          <h1 className="display text-lg text-slate-900 truncate">{brand.name}</h1>
          {brand.industry && <span className="hidden md:inline text-slate-400 text-sm font-semibold flex-shrink-0">{brand.industry.split("/")[0].trim()}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {latest && (
            <button onClick={shareReport}
              className="btn-ghost py-1.5 px-2.5 sm:px-3 flex items-center gap-1.5 text-xs font-semibold"
              title="Get a public read-only link">
              <Share2 className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span className="hidden sm:inline">{shareLabel}</span>
            </button>
          )}
          <AuditButton brandId={Number(id)} brandName={brand.name} />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-5 sm:px-6 py-8 space-y-6">
        {!latest ? (
          <div className="card p-16 text-center" style={{ borderStyle: "dashed" }}>
            {auditActive ? (
              <div className="space-y-5 max-w-xl mx-auto">
                <div className="flex items-center justify-center gap-2.5">
                  <span className="live-dot" />
                  <p className="text-slate-900 font-bold text-xl">Auditing {brand.name}…</p>
                </div>
                <p className="text-slate-500 text-sm font-semibold max-w-lg mx-auto leading-relaxed">
                  Asking real buyer questions across 4 AI models and measuring how often {brand.name} gets recommended. Live progress is in the panel above. This page refreshes when done (about 1 to 2 minutes).
                </p>
              </div>
            ) : (
              <div className="space-y-5 max-w-md mx-auto">
                <div className="w-14 h-14 rounded-2xl bg-[var(--accent-dim)] flex items-center justify-center mx-auto">
                  <Sparkles className="w-7 h-7 text-[var(--accent)]" />
                </div>
                <div className="space-y-2">
                  <p className="text-slate-900 font-bold text-lg">Run your first audit for {brand.name}</p>
                  <p className="text-slate-500 text-sm font-semibold leading-relaxed">
                    We&apos;ll ask about 10 buyer-style questions across 4 AI models and measure how often {brand.name} gets recommended, then show the exact questions and models where it appears.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[var(--accent)]">
                  <ArrowUp className="w-4 h-4 rotate-45" />
                  Click &quot;Run Audit&quot; in the top-right to begin
                </div>
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
              return findings.length > 0 && (
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
              );
            })()}

            {modelBias.models?.length > 0 && (
              <div className="card p-6">
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Model Breakdown</p>
                <p className="text-slate-400 text-xs font-medium mb-5 mt-0.5">How visible your brand is in each AI model individually</p>
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
                    {probePerf.bottom.length > 0 ? probePerf.bottom.map(({ prompt, hit_rate }: { prompt: string; hit_rate: number }) => (
                      <div key={prompt}>
                        <div className="flex justify-between gap-2 mb-1.5">
                          <p className="text-xs text-slate-600 flex-1 font-semibold">{prompt}</p>
                          <span className="text-red-600 text-xs font-bold tabular">{hit_rate}%</span>
                        </div>
                        <div className="w-full rounded-full h-1.5 bg-slate-100"><div className="h-full rounded-full bg-red-500" style={{ width: `${Math.max(hit_rate, 2)}%` }} /></div>
                      </div>
                    )) : (
                      <p className="text-xs text-slate-400 leading-relaxed">No significant gaps. Your brand surfaced on every tracked query.</p>
                    )}
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
              <ProbeDetail probes={probeDetail.probes} auditDate={probeDetail.audit_date}
                responses={probeResponses} brandName={brand.name} />
            )}

            {darkMatter.dark_matter_count > 0 && (
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-slate-800 font-bold text-sm">Where you&apos;re invisible <span className="text-slate-400 font-medium">· Dark Matter</span></p>
                    <p className="text-slate-400 text-xs mt-0.5">Questions where no AI model mentioned your brand.</p>
                  </div>
                  <span className="text-xs font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                    {darkMatter.dark_matter_count} of {darkMatter.total_probes} questions
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
