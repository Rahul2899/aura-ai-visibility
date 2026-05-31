"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { friendlyName, providerIcon } from "../lib/models";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type BrandOption = { id: number; name: string; visibility_pct: number | null };
type ModelBias = { model: string; visibility_pct: number };
type BrandData = {
  id: number; name: string;
  insight: { visibility_pct: number; key_findings: string[]; recommendations: string[]; summary: string } | null;
  models: ModelBias[];
};
type JobState = { status: string; visibility_pct?: number; probe_count?: number; error?: string };

export default function ComparePage() {
  const [allBrands, setAllBrands] = useState<BrandOption[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [newName, setNewName] = useState("");
  const [data, setData] = useState<BrandData[]>([]);
  const [jobs, setJobs] = useState<Record<number, JobState>>({});
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/brands/compare`).then(r => r.json()).then(setAllBrands).catch(() => []);
  }, []);

  function toggle(id: number) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function addAndSelect() {
    if (!newName.trim()) return;
    const res = await fetch(`${API}/brands`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), domain: newName.trim().toLowerCase().replace(/\s+/g, "") + ".com" }),
    });
    const brand = await res.json();
    setAllBrands(prev => [...prev, { id: brand.id, name: brand.name, visibility_pct: null }]);
    setSelected(prev => [...prev, brand.id]);
    setNewName("");
  }

  async function runParallelAudits() {
    if (selected.length === 0) return;
    setRunning(true);
    setJobs({});
    setData([]);

    // Fire all audits simultaneously
    const jobMap: Record<number, string> = {};
    await Promise.all(selected.map(async (brandId) => {
      const res = await fetch(`${API}/audit/brands/${brandId}`, { method: "POST" });
      const { job_id } = await res.json();
      jobMap[brandId] = job_id;
      setJobs(prev => ({ ...prev, [brandId]: { status: "running" } }));
    }));

    // Poll all jobs until all complete
    const poll = setInterval(async () => {
      const updates: Record<number, JobState> = {};
      let allDone = true;

      await Promise.all(Object.entries(jobMap).map(async ([brandId, jobId]) => {
        const r = await fetch(`${API}/audit/${jobId}`);
        const job: JobState = await r.json();
        updates[Number(brandId)] = job;
        if (job.status !== "completed" && job.status !== "failed") allDone = false;
      }));

      setJobs(updates);

      if (allDone) {
        clearInterval(poll);
        setRunning(false);
        await loadComparison();
      }
    }, 3000);
  }

  async function loadComparison() {
    if (selected.length === 0) return;
    setLoading(true);
    const results = await Promise.all(selected.map(async (id) => {
      const brand = allBrands.find(b => b.id === id);
      const [insights, bias] = await Promise.all([
        fetch(`${API}/brands/${id}/insights`).then(r => r.json()).catch(() => []),
        fetch(`${API}/brands/${id}/model-bias`).then(r => r.json()).catch(() => ({ models: [] })),
      ]);
      return {
        id, name: brand?.name ?? `Brand ${id}`,
        insight: insights[0] ?? null,
        models: bias.models ?? [],
      };
    }));
    setData(results);
    setLoading(false);
  }

  // Cross-brand analysis
  const allModelIds = [...new Set(data.flatMap(d => d.models.map(m => m.model)))].sort();

  function pctFor(d: BrandData, model: string): number | null {
    return d.models.find(x => x.model === model)?.visibility_pct ?? null;
  }

  // COMMON: models where every brand scores poorly (<35) — a category-wide blind spot
  const commonWeakModels = data.length >= 2
    ? allModelIds.filter(m => data.every(d => { const p = pctFor(d, m); return p !== null && p < 35; }))
    : [];

  // COMMON: models where every brand scores well (≥60) — a channel everyone wins
  const commonStrongModels = data.length >= 2
    ? allModelIds.filter(m => data.every(d => { const p = pctFor(d, m); return p !== null && p >= 60; }))
    : [];

  // DIFFERS: the model with the widest spread between brands — where the race is decided
  let biggestDiff: { model: string; spread: number; leader: string; laggard: string } | null = null;
  for (const m of allModelIds) {
    const scored = data.map(d => ({ name: d.name, pct: pctFor(d, m) })).filter(x => x.pct !== null) as { name: string; pct: number }[];
    if (scored.length < 2) continue;
    const hi = scored.reduce((a, b) => b.pct > a.pct ? b : a);
    const lo = scored.reduce((a, b) => b.pct < a.pct ? b : a);
    const spread = hi.pct - lo.pct;
    if (!biggestDiff || spread > biggestDiff.spread) {
      biggestDiff = { model: m, spread, leader: hi.name, laggard: lo.name };
    }
  }

  const leaderPerModel = Object.entries(Object.fromEntries(
    allModelIds.map(m => {
      let best = { name: "", pct: -1 };
      for (const d of data) { const p = pctFor(d, m); if (p !== null && p > best.pct) best = { name: d.name, pct: p }; }
      return [m, best.name];
    })
  ));

  const scoreColor = (pct: number) => pct >= 60 ? "var(--green)" : pct >= 35 ? "var(--amber)" : "var(--red)";

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      <header className="border-b px-8 py-4 flex items-center gap-4 sticky top-0 z-10 backdrop-blur-sm"
        style={{ borderColor: "var(--border)", background: "rgba(8,8,14,0.9)" }}>
        <Link href="/" className="text-sm transition-colors" style={{ color: "var(--text-3)" }}>← Dashboard</Link>
        <div className="w-px h-4" style={{ background: "var(--border-2)" }} />
        <span className="font-semibold" style={{ color: "var(--text)" }}>Multi-Brand Comparison</span>
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
          Audits run in parallel
        </span>
      </header>

      <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">

        {/* Brand selector */}
        <div className="card p-6">
          <p className="text-xs uppercase tracking-wide mb-4" style={{ color: "var(--text-3)" }}>Select brands to compare</p>

          <div className="flex flex-wrap gap-2 mb-4">
            {allBrands.map(b => (
              <button key={b.id} onClick={() => toggle(b.id)}
                className="px-3 py-1.5 rounded-lg text-sm transition-all"
                style={{
                  background: selected.includes(b.id) ? "var(--accent-dim)" : "var(--surface-2)",
                  border: `1px solid ${selected.includes(b.id) ? "var(--accent)" : "var(--border)"}`,
                  color: selected.includes(b.id) ? "var(--accent)" : "var(--text-2)",
                  fontWeight: selected.includes(b.id) ? 600 : 400,
                }}>
                {b.name}
                {b.visibility_pct !== null && <span className="ml-1.5 text-xs opacity-60">{b.visibility_pct?.toFixed(0)}%</span>}
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addAndSelect()}
              placeholder="Or type a new brand to add..."
              className="flex-1 rounded-lg px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
            <button onClick={addAndSelect} disabled={!newName.trim()} className="btn-primary">Add</button>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button onClick={runParallelAudits}
              disabled={selected.length === 0 || running}
              className="btn-primary flex items-center gap-2">
              {running ? <><span className="live-dot" /> Running audits...</> : `▶ Run ${selected.length} audit${selected.length !== 1 ? "s" : ""} in parallel`}
            </button>
            {selected.length > 0 && !running && (
              <button onClick={loadComparison} disabled={loading} className="btn-ghost">
                {loading ? "Loading..." : "Load existing data"}
              </button>
            )}
            {selected.length > 0 && (
              <button onClick={() => setSelected([])} className="text-sm" style={{ color: "var(--text-3)" }}>
                Clear selection
              </button>
            )}
          </div>

          {/* Job progress */}
          {Object.entries(jobs).length > 0 && (
            <div className="mt-4 space-y-2">
              {Object.entries(jobs).map(([brandId, job]) => {
                const brand = allBrands.find(b => b.id === Number(brandId));
                return (
                  <div key={brandId} className="flex items-center gap-3">
                    <span className="text-sm w-24 truncate" style={{ color: "var(--text-2)" }}>{brand?.name}</span>
                    <div className="flex-1 h-1 rounded-full" style={{ background: "var(--border)" }}>
                      <div className="h-1 rounded-full transition-all"
                        style={{
                          width: job.status === "completed" ? "100%" : `${Math.min((job.probe_count ?? 0) * 10, 85)}%`,
                          background: job.status === "completed" ? "var(--green)" : job.status === "failed" ? "var(--red)" : "var(--accent)"
                        }} />
                    </div>
                    <span className="text-xs w-20 text-right" style={{ color: job.status === "completed" ? "var(--green)" : "var(--text-3)" }}>
                      {job.status === "completed" ? `✓ ${job.visibility_pct?.toFixed(0)}%` : job.status === "failed" ? "✗ failed" : `${job.probe_count ?? 0} probes`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Results */}
        {data.length > 0 && (
          <>
            {/* Score overview */}
            <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
              {data.map(d => (
                <div key={d.id} className="card p-5 text-center">
                  <p className="font-semibold mb-3" style={{ color: "var(--text)" }}>{d.name}</p>
                  <p className="text-5xl font-bold tabular" style={{ color: d.insight ? scoreColor(d.insight.visibility_pct ?? 0) : "var(--text-3)" }}>
                    {d.insight ? `${d.insight.visibility_pct?.toFixed(0)}%` : "—"}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>AI Visibility</p>
                  <Link href={`/brands/${d.id}`} className="text-xs mt-2 inline-block" style={{ color: "var(--accent)" }}>
                    View full report →
                  </Link>
                </div>
              ))}
            </div>

            {/* Model bias matrix */}
            {allModelIds.length > 0 && (
              <div className="card p-6">
                <p className="text-xs uppercase tracking-wide mb-4" style={{ color: "var(--text-3)" }}>Model Bias Matrix</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left pb-3 pr-4 font-medium" style={{ color: "var(--text-3)", fontSize: 11 }}>MODEL</th>
                        {data.map(d => (
                          <th key={d.id} className="text-center pb-3 px-2 font-medium" style={{ color: "var(--text-2)", fontSize: 12, minWidth: 100 }}>{d.name}</th>
                        ))}
                        <th className="text-left pb-3 pl-4 font-medium" style={{ color: "var(--text-3)", fontSize: 11 }}>LEADER</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allModelIds.map(model => (
                        <tr key={model} className="border-t" style={{ borderColor: "var(--border)" }}>
                          <td className="py-3 pr-4 text-xs" style={{ color: "var(--text-2)" }}>
                            {providerIcon(model)} {friendlyName(model)}
                          </td>
                          {data.map(d => {
                            const m = d.models.find(x => x.model === model);
                            const pct = m?.visibility_pct;
                            return (
                              <td key={d.id} className="py-3 px-2 text-center">
                                {pct !== undefined ? (
                                  <span className="font-bold tabular" style={{ color: scoreColor(pct), fontSize: 15 }}>{pct.toFixed(0)}%</span>
                                ) : (
                                  <span style={{ color: "var(--text-3)" }}>—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="py-3 pl-4 text-xs" style={{ color: "var(--text-2)" }}>
                            {leaderPerModel.find(([m]) => m === model)?.[1] ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* What's common / what differs */}
            {data.length >= 2 && (
              <div className="grid grid-cols-3 gap-4">
                {/* Common strength */}
                <div className="card p-5">
                  <p className="text-xs uppercase tracking-wide mb-3" style={{ color: "var(--green)" }}>✓ Common Strength</p>
                  {commonStrongModels.length > 0 ? (
                    <>
                      <p className="text-sm mb-2" style={{ color: "var(--text-2)" }}>Every brand wins on:</p>
                      <div className="space-y-1">
                        {commonStrongModels.map(m => (
                          <p key={m} className="text-sm font-medium" style={{ color: "var(--text)" }}>{providerIcon(m)} {friendlyName(m)}</p>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>No model where all brands score 60%+ yet.</p>
                  )}
                </div>

                {/* Common gap */}
                <div className="card p-5">
                  <p className="text-xs uppercase tracking-wide mb-3" style={{ color: "var(--red)" }}>⚠ Common Gap</p>
                  {commonWeakModels.length > 0 ? (
                    <>
                      <p className="text-sm mb-2" style={{ color: "var(--text-2)" }}>Every brand is missing in:</p>
                      <div className="space-y-1">
                        {commonWeakModels.map(m => (
                          <p key={m} className="text-sm font-medium" style={{ color: "var(--text)" }}>{providerIcon(m)} {friendlyName(m)}</p>
                        ))}
                      </div>
                      <p className="text-xs mt-3" style={{ color: "var(--text-3)" }}>A category-wide training gap, not a single-brand issue.</p>
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>No model ignores every brand. Good coverage.</p>
                  )}
                </div>

                {/* Biggest differentiator */}
                <div className="card p-5">
                  <p className="text-xs uppercase tracking-wide mb-3" style={{ color: "var(--accent)" }}>◆ Where The Race Is Won</p>
                  {biggestDiff && biggestDiff.spread > 0 ? (
                    <>
                      <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>{providerIcon(biggestDiff.model)} {friendlyName(biggestDiff.model)}</p>
                      <p className="text-2xl font-bold tabular" style={{ color: "var(--accent)" }}>{biggestDiff.spread.toFixed(0)}pt gap</p>
                      <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                        <span className="font-medium" style={{ color: "var(--green)" }}>{biggestDiff.leader}</span> leads,{" "}
                        <span className="font-medium" style={{ color: "var(--red)" }}>{biggestDiff.laggard}</span> trails.
                      </p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>The model where brands differ most.</p>
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--text-3)" }}>Brands score evenly across models.</p>
                  )}
                </div>
              </div>
            )}

            {/* Key findings side by side */}
            {data.some(d => d.insight?.key_findings?.length) && (
              <div className="card p-6">
                <p className="text-xs uppercase tracking-wide mb-4" style={{ color: "var(--text-3)" }}>Key Findings Comparison</p>
                <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
                  {data.map(d => (
                    <div key={d.id}>
                      <p className="text-sm font-semibold mb-3" style={{ color: "var(--text)" }}>{d.name}</p>
                      {d.insight?.key_findings?.length ? (
                        <div className="space-y-2">
                          {d.insight.key_findings.slice(0, 3).map((f, i) => (
                            <div key={i} className="flex gap-2">
                              <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: f.includes("0%") || f.includes("drops") ? "var(--red)" : "var(--green)" }}>
                                {f.includes("0%") || f.includes("drops") ? "▼" : "▲"}
                              </span>
                              <p className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>{f}</p>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-xs" style={{ color: "var(--text-3)" }}>No structured findings. Run a new audit.</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Audit explanation */}
        <div className="card p-6">
          <p className="text-xs uppercase tracking-wide mb-3" style={{ color: "var(--text-3)" }}>Understanding Your Results</p>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Why do scores change between runs?</p>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
                Each audit generates fresh probe questions and queries models independently. AI responses are non-deterministic — the same question can get a different answer each time. Early runs with model failures (rate limits, wrong IDs) score lower because failed models count as 0%. Later runs with all models working give accurate measurements.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>What does AI visibility actually mean?</p>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
                When someone asks an AI "what HR software should I use?", does your brand appear in the answer? AI visibility measures this — across every AI model and ~10 different question angles. 55% means your brand appears in 55% of those AI responses. The goal: be the default recommendation.
              </p>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
