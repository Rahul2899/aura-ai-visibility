"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { friendlyName, providerKey } from "../lib/models";
import { getSessionId, getAdminKey } from "../lib/session";
import { createBrand, validateBrand } from "../lib/brands";
import {
  ArrowLeft,
  Play,
  CheckCircle2,
  XCircle,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  GitCompare,
  Plus,
  Loader2,
  ArrowDown,
  ArrowUp,
  ChevronRight
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type BrandOption = { id: number; name: string; visibility_pct: number | null; industry?: string | null };
type ModelBias = { model: string; visibility_pct: number };
type BrandData = {
  id: number;
  name: string;
  industry?: string | null;
  insight: { visibility_pct: number; key_findings: string[]; summary: string } | null;
  models: ModelBias[];
};
type JobState = { status: string; visibility_pct?: number; probe_count?: number; error?: string };

const PROVIDER_DOT_CLASSES: Record<string, string> = {
  amazon: "bg-amber-500 shadow-sm shadow-amber-500/20",
  anthropic: "bg-orange-500 shadow-sm shadow-orange-500/20",
  meta: "bg-blue-500 shadow-sm shadow-blue-500/20",
  google: "bg-emerald-500 shadow-sm shadow-emerald-500/20",
  openai: "bg-slate-400 shadow-sm shadow-zinc-350/20",
  generic: "bg-slate-400",
};

export default function ComparePage() {
  const [allBrands, setAllBrands] = useState<BrandOption[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [data, setData] = useState<BrandData[]>([]);
  const [jobs, setJobs] = useState<Record<number, JobState>>({});
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sess = getSessionId();
    fetch(`${API}/brands/compare?session_id=${sess}`)
      .then(r => r.json())
      .then(brands => {
        // Open empty: let the user choose which brands to compare rather than
        // guessing. Avoids confusing new users with a pre-filled comparison.
        if (Array.isArray(brands)) setAllBrands(brands);
      })
      .catch(() => []);
  }, []);

  function toggle(id: number) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function addAndSelect() {
    const validationError = validateBrand(newName);
    if (validationError) { setAddError(validationError); return; }
    setAddError(null);
    const result = await createBrand({ name: newName });
    if (!result.ok) { setAddError(result.error); return; }
    setAllBrands(prev => [...prev, { id: result.id, name: result.name, visibility_pct: null }]);
    setSelected(prev => [...prev, result.id]);
    setNewName("");
  }

  const loadComparison = useCallback(async () => {
    if (selected.length === 0 || allBrands.length === 0) return;
    setLoading(true);
    try {
      const sess = getSessionId();
      const hdrs: Record<string, string> = {};
      if (sess === "admin") hdrs["X-Admin-Key"] = getAdminKey();
      const qs = `session_id=${encodeURIComponent(sess)}`;
      const results = await Promise.all(selected.map(async (id) => {
        const brand = allBrands.find(b => b.id === id);
        const [insights, bias] = await Promise.all([
          fetch(`${API}/brands/${id}/insights?${qs}`, { headers: hdrs }).then(r => r.json()).catch(() => []),
          fetch(`${API}/brands/${id}/model-bias?${qs}`, { headers: hdrs }).then(r => r.json()).catch(() => ({ models: [] })),
        ]);
        return {
          id,
          name: brand?.name ?? `Brand ${id}`,
          industry: brand?.industry ?? null,
          insight: insights[0] ?? null,
          models: bias.models ?? [],
        };
      }));
      setData(results);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selected, allBrands]);

  async function runParallelAudits() {
    if (selected.length === 0) return;
    setRunning(true);
    setJobs({});
    setData([]);

    // Fire all audits simultaneously, skip any that fail
    const jobMap: Record<number, string> = {};
    await Promise.all(selected.map(async (brandId) => {
      try {
        const sess = getSessionId();
        const hdrs: Record<string, string> = {};
        if (sess === "admin") hdrs["X-Admin-Key"] = getAdminKey();
        const res = await fetch(`${API}/audit/brands/${brandId}?session_id=${sess}`, { method: "POST", headers: hdrs });
        if (!res.ok) { setJobs(prev => ({ ...prev, [brandId]: { status: "failed", error: `HTTP ${res.status}` } })); return; }
        const { job_id } = await res.json();
        if (!job_id) { setJobs(prev => ({ ...prev, [brandId]: { status: "failed", error: "No job ID returned" } })); return; }
        jobMap[brandId] = job_id;
        setJobs(prev => ({ ...prev, [brandId]: { status: "running" } }));
      } catch (e) {
        setJobs(prev => ({ ...prev, [brandId]: { status: "failed", error: String(e) } }));
      }
    }));

    if (Object.keys(jobMap).length === 0) { setRunning(false); return; }

    // Poll all jobs until all complete
    const pollId = setInterval(async () => {
      try {
        const updates: Record<number, JobState> = {};
        let allDone = true;

        await Promise.all(Object.entries(jobMap).map(async ([brandId, jobId]) => {
          try {
            const r = await fetch(`${API}/audit/${jobId}`);
            if (!r.ok) { updates[Number(brandId)] = { status: "failed", error: `HTTP ${r.status}` }; return; }
            const job: JobState = await r.json();
            updates[Number(brandId)] = job;
            if (job.status !== "completed" && job.status !== "failed") allDone = false;
          } catch { updates[Number(brandId)] = { status: "failed", error: "Poll error" }; }
        }));

        setJobs(updates);

        if (allDone) {
          clearInterval(pollId);
          setRunning(false);
          await loadComparison();
        }
      } catch { clearInterval(pollId); setRunning(false); }
    }, 3000);
  }

  // Auto-load comparison reports when selection updates
  useEffect(() => {
    if (selected.length > 0 && allBrands.length > 0 && !running) {
      loadComparison();
    } else if (selected.length === 0) {
      setData([]);
    }
  }, [selected, allBrands, running, loadComparison]);

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
      for (const d of data) {
        const p = pctFor(d, m);
        if (p !== null && p > best.pct) best = { name: d.name, pct: p };
      }
      return [m, best.name];
    })
  ));

  const scoreColor = (pct: number) => pct >= 60 ? "var(--green)" : pct >= 35 ? "var(--amber)" : "var(--red)";

  // Cross-category check: visibility isn't directly comparable across different
  // industries (an EV brand vs an HR suite). We warn but still allow the comparison.
  const selectedIndustries = Array.from(new Set(
    selected.map(id => allBrands.find(b => b.id === id)?.industry?.split("/")[0].trim()).filter(Boolean)
  ));
  const crossCategory = selectedIndustries.length > 1;

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header className="border-b px-8 py-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md"
        style={{ borderColor: "var(--border-solid)", background: "rgba(255,255,255,0.92)" }}>
        <div className="flex items-center gap-4">
          <Link href="/" className="btn-ghost py-1.5 px-3 flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 font-semibold">
            <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
          </Link>
          <div className="w-px h-4 bg-slate-200" />
          <span className="font-bold text-sm text-slate-900 tracking-tight">Multi-Brand Comparison</span>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full border border-[var(--border-2)] bg-[var(--accent-dim)] text-[var(--accent)]">
            Parallel Audits
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Brand selector panel */}
        <div className="card p-6 space-y-5">
          <div>
            <h2 className="text-slate-900 font-bold text-sm">Select Brands</h2>
            <p className="text-slate-500 text-xs mt-0.5 font-semibold">Pick brands to compare side-by-side, then run audits</p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {allBrands.map(b => {
              const isSelected = selected.includes(b.id);
              return (
                <button
                  key={b.id}
                  onClick={() => toggle(b.id)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer hover:border-slate-300 active:scale-95 text-left"
                  style={{
                    background: isSelected ? "var(--accent-dim)" : "var(--surface-2-solid)",
                    borderColor: isSelected ? "var(--accent)" : "var(--border)",
                    color: isSelected ? "var(--accent)" : "var(--text-2)",
                  }}
                  aria-pressed={isSelected}
                >
                  <span className="flex items-center">
                    {b.name}
                    {b.visibility_pct !== null && <span className="ml-2 font-extrabold opacity-70 tabular">{b.visibility_pct?.toFixed(0)}%</span>}
                  </span>
                  {b.industry && <span className="block text-[9px] font-bold uppercase tracking-wide opacity-50 mt-0.5">{b.industry.split("/")[0].trim()}</span>}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <div className="flex gap-3">
              <input value={newName} onChange={e => { setNewName(e.target.value); setAddError(null); }}
                onKeyDown={e => e.key === "Enter" && addAndSelect()}
                placeholder="Or type a new brand to add..."
                className="flex-1 input-field py-2.5 text-sm"
                aria-label="New brand name"
              />
              <button onClick={addAndSelect} disabled={!newName.trim()} className="btn-primary flex items-center gap-1.5 text-xs font-semibold">
                <Plus className="w-4 h-4 text-slate-900" /> Add
              </button>
            </div>
            {addError && <p role="alert" className="text-xs font-semibold text-red-600">{addError}</p>}
          </div>

          <div className="flex items-center flex-wrap gap-3 pt-2">
            <button onClick={runParallelAudits}
              disabled={selected.length < 2 || running}
              className="btn-primary flex items-center gap-2 text-xs font-semibold">
              {running ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
                  <span>Running audits…</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 text-slate-900 fill-white" />
                  <span>{selected.length >= 2 ? `Compare ${selected.length} brands` : "Compare brands"}</span>
                </>
              )}
            </button>
            {selected.length > 0 && !running && (
              <button onClick={loadComparison} disabled={loading} className="btn-ghost flex items-center gap-2 text-xs font-semibold">
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading reports…</span>
                  </>
                ) : (
                  <span>Load report matrix</span>
                )}
              </button>
            )}
            {selected.length > 0 && (
              <button onClick={() => setSelected([])} className="text-xs text-slate-400 hover:text-slate-600 font-bold cursor-pointer py-2 px-3 hover:bg-slate-100 rounded-xl transition-colors ml-auto">
                Clear selection
              </button>
            )}
          </div>

          {/* Selection hint + cross-category warning */}
          {selected.length < 2 && (
            <p className="text-xs font-semibold text-slate-400">Select at least 2 brands to compare them side by side.</p>
          )}
          {crossCategory && selected.length >= 2 && (
            <div className="flex items-start gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>These brands span different categories ({selectedIndustries.join(", ")}). Visibility scores aren&apos;t directly comparable across industries.</span>
            </div>
          )}

          {/* Parallel Job progress */}
          {Object.entries(jobs).length > 0 && (
            <div className="pt-5 border-t border-slate-100 space-y-3">
              {Object.entries(jobs).map(([brandId, job]) => {
                const brand = allBrands.find(b => b.id === Number(brandId));
                const isCompleted = job.status === "completed";
                const isFailed = job.status === "failed";
                const progressWidth = isCompleted ? "100%" : `${Math.min((job.probe_count ?? 0) * 10, 85)}%`;
                const progressColor = isCompleted ? "var(--green)" : isFailed ? "var(--red)" : "var(--accent)";

                return (
                  <div key={brandId} className="flex items-center gap-4">
                    <span className="text-xs font-bold text-slate-700 w-24 truncate">{brand?.name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                      <div className="h-full rounded-full transition-all duration-500 ease-out"
                        style={{
                          width: progressWidth,
                          backgroundColor: progressColor,
                          boxShadow: !isCompleted && !isFailed ? "0 0 4px var(--accent-glow)" : undefined
                        }} />
                    </div>
                    <span className="text-xs font-bold w-24 text-right flex items-center justify-end gap-1.5" style={{ color: isCompleted ? "var(--green)" : isFailed ? "var(--red)" : "var(--text-2)" }}>
                      {isCompleted ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="tabular">{job.visibility_pct?.toFixed(0)}%</span>
                        </>
                      ) : isFailed ? (
                        <>
                          <XCircle className="w-3.5 h-3.5 text-red-400" />
                          <span>failed</span>
                        </>
                      ) : (
                        <span className="tabular">{job.probe_count ?? 0}/10 probes</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Empty state — no brands selected yet */}
        {selected.length === 0 && !running && (
          <div className="card p-12 text-center" style={{ borderStyle: "dashed" }}>
            <p className="text-slate-700 font-bold text-base mb-1">Select brands to compare</p>
            <p className="text-slate-400 text-sm">Choose 2 or more brands from the left panel to see a side-by-side AI visibility breakdown.</p>
          </div>
        )}

        {/* Comparison Results */}
        {data.length > 0 && (
          <>
            {/* Score cards grid */}
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))` }}>
              {data.map(d => (
                <div key={d.id} className="card p-5 text-center flex flex-col items-center justify-center">
                  <p className="font-extrabold text-sm text-slate-700">{d.name}</p>
                  {d.industry && <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-2">{d.industry.split("/")[0].trim()}</span>}
                  <p className="text-5xl font-extrabold tabular leading-none my-2" style={{ color: d.insight ? scoreColor(d.insight.visibility_pct ?? 0) : "var(--text-3)" }}>
                    {d.insight ? `${d.insight.visibility_pct?.toFixed(0)}%` : "No data"}
                  </p>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-1">AI Visibility</p>
                  <Link href={`/brands/${d.id}`} className="text-xs text-[var(--accent)] hover:brightness-110 font-bold mt-4 inline-flex items-center gap-1.5">
                    View report <ChevronRight className="w-3.5 h-3.5 text-[var(--accent)]" />
                  </Link>
                </div>
              ))}
            </div>

            {/* Model matrix comparison */}
            {allModelIds.length > 0 && (
              <div className="card p-6 overflow-hidden">
                <p className="text-slate-500 text-xs uppercase font-bold tracking-wider">Model Bias Matrix</p>
                <p className="text-slate-400 text-xs font-medium mb-5 mt-0.5">Each brand&apos;s visibility in each AI model. Spot which models favor which brand.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="text-left pb-3 pr-4 font-bold text-slate-400 uppercase tracking-wider text-[10px] pl-3" style={{ minWidth: 170 }}>MODEL</th>
                        {data.map(d => (
                          <th key={d.id} className="text-center pb-3 px-2 font-bold text-slate-700 text-xs tracking-tight uppercase" style={{ minWidth: 100 }}>{d.name}</th>
                        ))}
                        <th className="text-left pb-3 pl-4 font-bold text-slate-400 uppercase tracking-wider text-[10px]" style={{ minWidth: 140 }}>LEADER</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-slate-50/50">
                      {allModelIds.map(model => {
                        const provider = providerKey(model);
                        const dotClass = PROVIDER_DOT_CLASSES[provider] || PROVIDER_DOT_CLASSES.generic;

                        return (
                          <tr key={model} className="hover:bg-slate-50 transition-colors">
                            <td className="py-3.5 pr-4 text-xs font-semibold text-slate-600 flex items-center gap-2 pl-3">
                              <span className={`w-2 h-2 rounded-full ${dotClass} flex-shrink-0`} />
                              <span>{friendlyName(model)}</span>
                            </td>
                            {data.map(d => {
                              const m = d.models.find(x => x.model === model);
                              const pct = m?.visibility_pct;
                              return (
                                <td key={d.id} className="py-3.5 px-2 text-center">
                                  {pct !== undefined ? (
                                    <span className="font-extrabold tabular text-base" style={{ color: scoreColor(pct) }}>{pct.toFixed(0)}%</span>
                                  ) : (
                                    <span className="text-slate-300 font-semibold">—</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="py-3.5 pl-4 text-xs font-bold text-slate-700">
                              {leaderPerModel.find(([m]) => m === model)?.[1] ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Highlights Bento grid */}
            {data.length >= 2 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Common strength */}
                <div className="card p-5 space-y-3" style={{ background: "var(--green-dim)", borderColor: "rgba(16,185,129,0.15)" }}>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    Common Strength
                  </p>
                  {commonStrongModels.length > 0 ? (
                    <>
                      <p className="text-xs text-slate-500 leading-normal font-semibold">Every brand wins on:</p>
                      <div className="space-y-2">
                        {commonStrongModels.map(m => {
                          const provider = providerKey(m);
                          const dotClass = PROVIDER_DOT_CLASSES[provider] || PROVIDER_DOT_CLASSES.generic;
                          return (
                            <div key={m} className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                              <span className="text-xs font-bold text-slate-700">{friendlyName(m)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 leading-relaxed font-semibold">No model where all brands score 60%+ yet.</p>
                  )}
                </div>

                {/* Common gap */}
                <div className="card p-5 space-y-3" style={{ background: "var(--red-dim)", borderColor: "rgba(239,68,68,0.15)" }}>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    Common Gap
                  </p>
                  {commonWeakModels.length > 0 ? (
                    <>
                      <p className="text-xs text-slate-500 leading-normal font-semibold">Every brand is missing in:</p>
                      <div className="space-y-2">
                        {commonWeakModels.map(m => {
                          const provider = providerKey(m);
                          const dotClass = PROVIDER_DOT_CLASSES[provider] || PROVIDER_DOT_CLASSES.generic;
                          return (
                            <div key={m} className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                              <span className="text-xs font-bold text-slate-700">{friendlyName(m)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-slate-400 leading-snug pt-2 font-bold border-t border-slate-100">
                        Suggests a category-wide training block rather than single-brand drift.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 leading-relaxed font-semibold">No model ignores every brand. Footprint is solid.</p>
                  )}
                </div>

                {/* Biggest differentiator */}
                <div className="card p-5 space-y-3" style={{ background: "var(--accent-dim)", borderColor: "var(--accent-glow)" }}>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-[var(--accent)] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                    Key Differentiator
                  </p>
                  {biggestDiff && biggestDiff.spread > 0 ? (
                    <>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${PROVIDER_DOT_CLASSES[providerKey(biggestDiff.model)] || PROVIDER_DOT_CLASSES.generic}`} />
                          <span className="text-xs font-extrabold text-slate-700">{friendlyName(biggestDiff.model)}</span>
                        </div>
                        <p className="text-3xl font-extrabold tabular text-[var(--accent)] mt-2">{biggestDiff.spread.toFixed(0)}pt gap</p>
                      </div>
                      <p className="text-xs text-slate-500 leading-normal font-semibold">
                        <span className="font-bold text-emerald-400">{biggestDiff.leader}</span> leads, while{" "}
                        <span className="font-bold text-red-400">{biggestDiff.laggard}</span> lags.
                      </p>
                      <p className="text-[10px] text-slate-400 font-bold leading-normal pt-2 border-t border-slate-100">
                        The core AI model that decides the category winner.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 leading-relaxed font-semibold">Brands score evenly across models.</p>
                  )}
                </div>
              </div>
            )}

            {/* Key findings panel */}
            {data.some(d => d.insight?.key_findings?.length) && (
              <div className="card p-6">
                <p className="text-slate-500 text-xs uppercase font-bold tracking-wider mb-5">Key Findings Comparison</p>
                <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {data.map(d => (
                    <div key={d.id} className="space-y-4">
                      <p className="text-sm font-extrabold text-slate-900 border-b pb-2 border-slate-100">{d.name}</p>
                      {d.insight?.key_findings?.length ? (
                        <div className="space-y-3">
                          {d.insight.key_findings.slice(0, 3).map((f, i) => {
                            const isDown = f.includes("0%") || f.includes("drops") || f.includes("invisible") || f.toLowerCase().includes("weak");
                            return (
                              <div key={i} className="flex items-start gap-2">
                                {isDown ? (
                                  <ArrowDown className="w-3.5 h-3.5 mt-0.5 text-red-400 flex-shrink-0 bg-red-950/20 p-0.5 rounded" />
                                ) : (
                                  <ArrowUp className="w-3.5 h-3.5 mt-0.5 text-emerald-400 flex-shrink-0 bg-emerald-950/20 p-0.5 rounded" />
                                )}
                                <p className="text-xs text-slate-700 leading-relaxed font-semibold">{f}</p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 font-semibold">No structured findings generated. Run a new audit to synthesize.</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Summary info cards */}
        <div className="card p-6">
          <p className="text-slate-500 text-xs uppercase font-bold tracking-wider mb-4">Understanding Comparison Metrics</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">Why do scores change between runs?</h3>
              <p className="text-slate-400 text-xs leading-relaxed font-semibold">
                Each audit generates fresh probe questions and queries models independently. AI responses are non-deterministic, so the same question can get a different answer each time. Early runs with model failures (rate limits, wrong IDs) score lower because failed models count as 0%. Later runs with all models working give accurate measurements.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">What does AI visibility actually mean?</h3>
              <p className="text-slate-400 text-xs leading-relaxed font-semibold">
                When someone asks an AI for a product recommendation in your category, does your brand appear? AI visibility measures this across every model and ~10 question angles. 55% means your brand appears in 55% of those responses.
              </p>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
