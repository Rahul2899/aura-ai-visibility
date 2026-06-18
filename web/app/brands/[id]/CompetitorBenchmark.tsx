"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrand } from "../../lib/brands";
import { authHeaders } from "../../lib/session";
import { Swords, Loader2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Competitor = { name: string; mentions: number };

export default function CompetitorBenchmark({ brandId, brandName, industry, isExample }: {
  brandId: number; brandName: string; industry: string | null; isExample: boolean;
}) {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [benchmarking, setBenchmarking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch(`${API}/brands/${brandId}/competitors`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then(setCompetitors)
      .catch(() => setCompetitors([]));
  }, [brandId]);

  if (competitors.length === 0) return null;

  const max = Math.max(...competitors.map((c) => c.mentions), 1);

  // Create the competitor as a brand (same industry, so the category questions match),
  // then open the side-by-side compare. The compare page audits any brand lacking data
  // as one batch = one credit.
  async function benchmark(name: string) {
    if (benchmarking) return;
    setError(null);
    setBenchmarking(name);
    const res = await createBrand({ name, domain: "", industry: industry || "" });
    if (!res.ok) {
      setError(res.error ?? "Couldn't set up the benchmark.");
      setBenchmarking(null);
      return;
    }
    router.push(`/compare?ids=${brandId},${res.id}`);
  }

  return (
    <div className="card p-6">
      <div className="mb-1 flex items-center gap-2">
        <Swords className="w-4 h-4 text-[var(--accent)]" />
        <p className="text-slate-800 font-bold text-sm">Who AI recommends instead of {brandName}</p>
      </div>
      <p className="text-slate-400 text-xs mb-5 leading-snug">
        The brands the AI models named in your category, ranked by how often they came up across your probes.
        These are the real rivals winning the questions, read from the models&apos; own answers.
      </p>

      <div className="space-y-2">
        {competitors.map((c) => (
          <div key={c.name} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-white">
            <span className="text-sm font-bold text-slate-700 w-44 truncate">{c.name}</span>
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(c.mentions / max) * 100}%` }} />
            </div>
            <span className="text-[11px] font-bold tabular text-slate-500 w-20 text-right">
              {c.mentions} mention{c.mentions !== 1 ? "s" : ""}
            </span>
            {!isExample && (
              <button
                onClick={() => benchmark(c.name)}
                disabled={benchmarking !== null}
                className="text-[11px] font-semibold rounded-lg border border-slate-200 hover:border-[var(--accent)] hover:bg-[var(--accent-dim)] px-2.5 py-1 transition-colors disabled:opacity-50 flex items-center gap-1 flex-shrink-0"
              >
                {benchmarking === c.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Swords className="w-3 h-3 text-slate-400" />}
                Benchmark
              </button>
            )}
          </div>
        ))}
      </div>

      {!isExample && (
        <p className="text-[11px] text-slate-400 mt-3">Benchmark adds the rival as a brand and runs a head-to-head comparison (~30s).</p>
      )}
      {error && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
}
