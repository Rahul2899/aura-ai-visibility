import Link from "next/link";
import { notFound } from "next/navigation";
import AuditButton from "./AuditButton";
import DeleteInsightButton from "./DeleteInsightButton";
import ScoreRing from "./ScoreRing";
import VisibilityChart from "./VisibilityChart";
import ModelGrid from "../../components/ModelGrid";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function getData(id: string) {
  const [brands, insights, modelBias, probePerf, compare] = await Promise.all([
    fetch(`${API}/brands`, { cache: "no-store" }).then(r => r.json()).catch(() => []),
    fetch(`${API}/brands/${id}/insights`, { cache: "no-store" }).then(r => r.json()).catch(() => []),
    fetch(`${API}/brands/${id}/model-bias`, { cache: "no-store" }).then(r => r.json()).catch(() => ({ models: [] })),
    fetch(`${API}/brands/${id}/probe-performance`, { cache: "no-store" }).then(r => r.json()).catch(() => ({ top: [], bottom: [] })),
    fetch(`${API}/brands/compare`, { cache: "no-store" }).then(r => r.json()).catch(() => []),
  ]);
  return { brands, insights, modelBias, probePerf, compare };
}

export default async function BrandPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autostart?: string }>;
}) {
  const { id } = await params;
  const { autostart } = await searchParams;
  const { brands, insights, modelBias, probePerf, compare } = await getData(id);

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

  // Fallback: parse prose summary into bullets for old audits without key_findings
  function summaryToBullets(summary: string): string[] {
    return summary.split(/\.\s+/).filter(s => s.length > 20 && s.length < 120).slice(0, 3).map(s => s.trim().replace(/\.$/, ""));
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header className="border-b px-8 py-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm"
        style={{ borderColor: "var(--border)", background: "rgba(9,9,11,0.85)" }}>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">← Back</Link>
          <div className="w-px h-4 bg-zinc-800" />
          <h1 className="font-semibold">{brand.name}</h1>
          {brand.domain && <span className="text-zinc-600 text-sm">{brand.domain}</span>}
        </div>
        <AuditButton brandId={Number(id)} />
      </header>

      <div className="max-w-4xl mx-auto px-8 py-8">

        {!latest ? (
          <div className="rounded-xl border p-16 text-center" style={{ borderColor: "var(--border)", borderStyle: "dashed" }}>
            {autostart === "1" ? (
              <>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="live-dot" />
                  <p className="text-zinc-200 font-medium text-lg">Audit starting…</p>
                </div>
                <p className="text-zinc-600 text-sm">Generating probe questions and querying AI models. Live progress is in the top-right. This page refreshes when done (~1–2 min).</p>
              </>
            ) : (
              <>
                <p className="text-zinc-300 font-medium text-lg mb-2">No audits yet</p>
                <p className="text-zinc-600 text-sm">Click "Run Audit" above to measure how visible {brand.name} is across AI models.</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">

            {/* Hero score */}
            <div className="rounded-xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between">
                <ScoreRing pct={latest.visibility_pct ?? 0} rank={rank} total={totalBrands > 1 ? totalBrands : undefined} />
                {trend !== null && (
                  <div className={`text-center px-5 py-3 rounded-xl border cursor-help ${trend > 0 ? "border-emerald-900" : trend < 0 ? "border-red-900" : "border-zinc-800"}`}
                    style={{ background: trend > 0 ? "rgba(16,185,129,0.08)" : trend < 0 ? "rgba(239,68,68,0.08)" : "var(--surface-2)" }}
                    title="Scores vary between audits: AI responses are non-deterministic, each run uses fresh probe questions, and any model that failed to respond is excluded from the score (not counted as a miss).">
                    <p className={`text-3xl font-bold ${trend > 0 ? "text-emerald-400" : trend < 0 ? "text-red-400" : "text-zinc-400"}`}>
                      {trend > 0 ? "+" : ""}{trend.toFixed(1)}%
                    </p>
                    <p className="text-zinc-500 text-xs mt-1">vs last audit ⓘ</p>
                  </div>
                )}
              </div>
              {latest.summary && (
                <p className="text-sm mt-5 italic border-t pt-4" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
                  "{latest.summary.length > 180 ? latest.summary.slice(0, 180) + "…" : latest.summary}"
                </p>
              )}
            </div>

            {/* Findings + Recommendations side by side */}
            {(() => {
              const findings = latest.key_findings?.length > 0 ? latest.key_findings : summaryToBullets(latest.summary);
              const hasRecs = latest.recommendations?.length > 0;
              return (findings.length > 0 || hasRecs) && (
              <div className="grid grid-cols-2 gap-4">
                {findings.length > 0 && (
                  <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                    <p className="text-zinc-500 text-xs uppercase tracking-wide mb-4">Key Findings</p>
                    <div className="space-y-3">
                      {findings.map((f: string, i: number) => {
                        const bad = f.toLowerCase().includes("0%") || f.toLowerCase().includes("drops") || f.toLowerCase().includes("invisible") || f.toLowerCase().includes("weak");
                        return (
                          <div key={i} className="flex gap-2.5">
                            <span className={`text-xs mt-0.5 flex-shrink-0 font-bold ${bad ? "text-red-400" : "text-emerald-400"}`}>{bad ? "▼" : "▲"}</span>
                            <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>{f}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {hasRecs && (
                  <div className="rounded-xl border p-5" style={{ background: "rgba(92,110,245,0.05)", borderColor: "#2a2a50" }}>
                    <p className="text-xs uppercase tracking-wide mb-4" style={{ color: "var(--accent)" }}>Action Plan</p>
                    <div className="space-y-3">
                      {latest.recommendations.map((r: string, i: number) => (
                        <div key={i} className="flex gap-2.5">
                          <span className="font-bold text-sm flex-shrink-0" style={{ color: "var(--accent)" }}>{i + 1}.</span>
                          <p className="text-sm leading-relaxed" style={{ color: "#c0c0e0" }}>{r}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
            })()}

            {/* Model breakdown */}
            {modelBias.models?.length > 0 && (
              <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-zinc-500 text-xs uppercase tracking-wide">Model Breakdown</p>
                  <p className="text-zinc-600 text-xs">Which AI mentions {brand.name}</p>
                </div>
                <ModelGrid models={modelBias.models} />
              </div>
            )}

            {/* Probe performance */}
            {(probePerf.top?.length > 0 || probePerf.bottom?.length > 0) && (
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                  <p className="text-emerald-500 text-xs uppercase tracking-wide mb-4">Strongest Queries</p>
                  <div className="space-y-3">
                    {probePerf.top.map(({ prompt, hit_rate }: { prompt: string; hit_rate: number }) => (
                      <div key={prompt}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-zinc-400 text-xs leading-relaxed flex-1 mr-2">{prompt}</p>
                          <span className="text-emerald-400 text-xs font-bold flex-shrink-0">{hit_rate}%</span>
                        </div>
                        <div className="w-full rounded-full h-0.5 bg-zinc-800">
                          <div className="h-0.5 rounded-full bg-emerald-500" style={{ width: `${hit_rate}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                  <p className="text-red-500 text-xs uppercase tracking-wide mb-4">Visibility Gaps</p>
                  <div className="space-y-3">
                    {probePerf.bottom.map(({ prompt, hit_rate }: { prompt: string; hit_rate: number }) => (
                      <div key={prompt}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-zinc-400 text-xs leading-relaxed flex-1 mr-2">{prompt}</p>
                          <span className="text-red-400 text-xs font-bold flex-shrink-0">{hit_rate}%</span>
                        </div>
                        <div className="w-full rounded-full h-0.5 bg-zinc-800">
                          <div className="h-0.5 rounded-full bg-red-500" style={{ width: `${Math.max(hit_rate, 2)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Over time chart */}
            {chartData.length > 1 && (
              <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <p className="text-zinc-500 text-xs uppercase tracking-wide mb-4">Visibility Over Time</p>
                <VisibilityChart data={chartData} />
              </div>
            )}

            {/* How to win — collapsed */}
            <details className="rounded-xl border overflow-hidden group" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <summary className="px-5 py-4 cursor-pointer text-zinc-500 text-sm hover:text-zinc-300 transition-colors flex items-center justify-between">
                <span>How to improve AI visibility</span>
                <span className="text-zinc-700 group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="px-5 pb-5 grid grid-cols-2 gap-3 border-t" style={{ borderColor: "var(--border)" }}>
                <div className="pt-4" />
                {[
                  { icon: "⭐", title: "G2 & Review Platforms", desc: "Reviews mentioning your use case train AI to recommend you in that context." },
                  { icon: "📖", title: "Wikipedia", desc: "Missing or thin Wikipedia page = invisible in factual AI queries." },
                  { icon: "🔄", title: "Comparison Content", desc: "\"Brand A vs B\" pages are aggressively crawled by AI training scrapers." },
                  { icon: "📰", title: "Press Coverage", desc: "Gartner, TechCrunch, Forbes carry massive weight in AI training data." },
                  { icon: "💬", title: "Reddit & Forums", desc: "Community discussions are over-represented in LLM training datasets." },
                  { icon: "🎯", title: "Brand Consistency", desc: "Use the exact same brand name everywhere — AI models treat variations as different entities." },
                ].map(({ icon, title, desc }) => (
                  <div key={title} className="flex gap-3 col-span-1">
                    <span className="text-base flex-shrink-0">{icon}</span>
                    <div>
                      <p className="text-zinc-200 text-xs font-medium">{title}</p>
                      <p className="text-zinc-600 text-xs mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </details>

            {/* Audit history — collapsed */}
            <details className="rounded-xl border overflow-hidden" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <summary className="px-5 py-4 cursor-pointer text-zinc-500 text-sm hover:text-zinc-300 transition-colors">
                Audit history ({insights.length} run{insights.length !== 1 ? "s" : ""})
              </summary>
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {insights.map((ins: { id: number; created_at: string; summary: string; probe_count: number; visibility_pct: number }, i: number) => (
                  <div key={ins.id} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{ins.visibility_pct?.toFixed(1)}%</span>
                        {i === 0 && <span className="text-xs bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-900">Latest</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-600 text-xs">{new Date(ins.created_at).toLocaleDateString()}</span>
                        <DeleteInsightButton brandId={Number(id)} insightId={ins.id} />
                      </div>
                    </div>
                    <p className="text-zinc-500 text-sm leading-relaxed">{ins.summary}</p>
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
