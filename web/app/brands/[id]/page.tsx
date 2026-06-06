import Link from "next/link";
import { notFound } from "next/navigation";
import AuditButton from "./AuditButton";
import DeleteInsightButton from "./DeleteInsightButton";
import ProbeDetail from "./ProbeDetail";
import ScoreRing from "./ScoreRing";
import VisibilityChart from "./VisibilityChart";
import ModelGrid from "../../components/ModelGrid";
import {
  ArrowLeft,
  Info,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Sparkles
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function getData(id: string) {
  const [brands, insights, modelBias, probePerf, compare, probeDetail] = await Promise.all([
    fetch(`${API}/brands`, { cache: "no-store" }).then(r => r.json()).catch(() => []),
    fetch(`${API}/brands/${id}/insights`, { cache: "no-store" }).then(r => r.json()).catch(() => []),
    fetch(`${API}/brands/${id}/model-bias`, { cache: "no-store" }).then(r => r.json()).catch(() => ({ models: [] })),
    fetch(`${API}/brands/${id}/probe-performance`, { cache: "no-store" }).then(r => r.json()).catch(() => ({ top: [], bottom: [] })),
    fetch(`${API}/brands/compare`, { cache: "no-store" }).then(r => r.json()).catch(() => []),
    fetch(`${API}/brands/${id}/probe-detail`, { cache: "no-store" }).then(r => r.json()).catch(() => ({ probes: [], audit_date: null })),
  ]);
  return { brands, insights, modelBias, probePerf, compare, probeDetail };
}

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autostart?: string }>;
}) {
  const { id } = await params;
  const { autostart } = await searchParams;
  const { brands, insights, modelBias, probePerf, compare, probeDetail } = await getData(id);

  const brand = brands.find((b: { id: number }) => b.id === Number(id));
  if (!brand) notFound();

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

  // Fallback: parse summary string to bullet points for historical runs
  function summaryToBullets(summary: string): string[] {
    return summary.split(/\.\s+/).filter(s => s.length > 20 && s.length < 120).slice(0, 3).map(s => s.trim().replace(/\.$/, ""));
  }

  return (
    <main className="min-h-screen animate-fade-in" style={{ background: "var(--bg)" }}>
      {/* Header Layout */}
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
                  Generating category-specific probe questions and querying AI models. Live progress is in the top-right. This page refreshes when done (~1–2 min).
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-slate-800 font-bold text-lg">No audits executed yet</p>
                <p className="text-slate-500 text-sm font-semibold">Click "Run Audit" above to measure how visible {brand.name} is across AI models.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">

            {/* Hero score panel */}
            <div className="card p-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                <ScoreRing pct={latest.visibility_pct ?? 0} rank={rank} total={totalBrands > 1 ? totalBrands : undefined} />
                {trend !== null && (
                  <div className={`text-center px-5 py-3.5 rounded-2xl border flex flex-col items-center justify-center min-w-36 cursor-help transition-colors ${trend > 0 ? "border-emerald-200 bg-emerald-50" : trend < 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}
                    title="Scores vary between audits: AI responses are non-deterministic, each run uses fresh probe questions, and any model that failed to respond is excluded from the score (not counted as a miss).">
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

            {/* Findings + Recommendations split grid */}
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
                          const bad = f.toLowerCase().includes("0%") || f.toLowerCase().includes("drops") || f.toLowerCase().includes("invisible") || f.toLowerCase().includes("weak");
                          return (
                            <div key={i} className="flex items-start gap-2.5">
                              {bad ? (
                                <ArrowDown className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500 bg-red-50 p-0.5 rounded" />
                              ) : (
                                <ArrowUp className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600 bg-emerald-50 p-0.5 rounded" />
                              )}
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
                            <Sparkles className="w-4 h-4 mt-0.5 text-[var(--accent)] flex-shrink-0 bg-[var(--accent-dim)] p-0.5 rounded" />
                            <p className="text-sm text-slate-700 leading-relaxed font-semibold">{r}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Model matrix breakdown */}
            {modelBias.models?.length > 0 && (
              <div className="card p-6">
                <div className="flex items-center justify-between mb-5">
                  <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Model Breakdown</p>
                  <p className="text-slate-400 text-xs font-semibold">LLM recommendation matrix</p>
                </div>
                <ModelGrid models={modelBias.models} />
              </div>
            )}

            {/* Probe performance charts */}
            {(probePerf.top?.length > 0 || probePerf.bottom?.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="card p-6">
                  <p className="text-emerald-400 text-[10px] uppercase font-bold tracking-wider mb-4">Strongest Queries</p>
                  <div className="space-y-4.5">
                    {probePerf.top.map(({ prompt, hit_rate }: { prompt: string; hit_rate: number }) => (
                      <div key={prompt}>
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                          <p className="text-zinc-350 text-xs leading-normal flex-1 font-semibold">{prompt}</p>
                          <span className="text-emerald-700 text-xs font-bold tabular bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">{hit_rate}%</span>
                        </div>
                        <div className="w-full rounded-full h-1.5 bg-slate-100 overflow-hidden" style={{ border: "1px solid var(--border-solid)" }}>
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${hit_rate}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card p-6">
                  <p className="text-red-400 text-[10px] uppercase font-bold tracking-wider mb-4">Visibility Gaps</p>
                  <div className="space-y-4.5">
                    {probePerf.bottom.map(({ prompt, hit_rate }: { prompt: string; hit_rate: number }) => (
                      <div key={prompt}>
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                          <p className="text-zinc-350 text-xs leading-normal flex-1 font-semibold">{prompt}</p>
                          <span className="text-red-600 text-xs font-bold tabular bg-red-50 px-1.5 py-0.5 rounded border border-red-200">{hit_rate}%</span>
                        </div>
                        <div className="w-full rounded-full h-1.5 bg-slate-100 overflow-hidden" style={{ border: "1px solid var(--border-solid)" }}>
                          <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.max(hit_rate, 2)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Over time visualization */}
            {chartData.length > 1 && (
              <div className="card p-6">
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-5">Visibility Over Time</p>
                <VisibilityChart data={chartData} />
              </div>
            )}

            {/* Probe transparency — what questions were asked */}
            {probeDetail.probes.length > 0 && (
              <ProbeDetail probes={probeDetail.probes} auditDate={probeDetail.audit_date} />
            )}

            {/* Historical runs matrix */}
            <details className="card overflow-hidden group">
              <summary className="px-6 py-4.5 cursor-pointer text-slate-600 text-sm font-bold hover:text-slate-900 transition-colors flex items-center justify-between select-none">
                <span>Audit history ({insights.length} run{insights.length !== 1 ? "s" : ""})</span>
                <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/50">
                {insights.map((ins: { id: number; created_at: string; summary: string; probe_count: number; visibility_pct: number }, i: number) => (
                  <div key={ins.id} className="px-6 py-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-slate-900 tabular bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{ins.visibility_pct?.toFixed(1)}%</span>
                        {i === 0 && <span className="text-[9px] uppercase font-bold tracking-wide bg-[var(--accent-dim)] text-[var(--accent)] px-2 py-0.5 rounded-full border border-[var(--border-2)]">Latest</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 text-xs font-semibold tabular">{new Date(ins.created_at).toLocaleDateString()}</span>
                        <DeleteInsightButton brandId={Number(id)} insightId={ins.id} brandSessionId={brand.session_id} />
                      </div>
                    </div>
                    <p className="text-slate-500 text-sm leading-relaxed font-semibold">{ins.summary}</p>
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
