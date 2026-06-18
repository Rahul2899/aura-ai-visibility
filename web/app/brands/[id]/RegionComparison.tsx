"use client";

import { useState } from "react";
import { getSessionId, getAdminKey } from "../../lib/session";
import { Globe, MapPin, Loader2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Regions a user can measure a brand in. "Global" is the default framing (region=null).
const REGIONS = ["United States", "Europe", "Germany", "United Kingdom", "India"];

type Insight = { visibility_pct: number | null; region?: string | null; created_at: string };

// Latest score per region from the brand's insight history. null region = "Global".
function latestByRegion(insights: Insight[]): Record<string, number> {
  const out: Record<string, number> = {};
  // insights arrive newest-first, so the first one seen per region is the latest.
  for (const ins of insights) {
    if (ins.visibility_pct == null) continue;
    const key = ins.region?.trim() || "Global";
    if (!(key in out)) out[key] = ins.visibility_pct;
  }
  return out;
}

export default function RegionComparison({ brandId, isExample, insights }: {
  brandId: number; isExample: boolean; insights: Insight[];
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scores = latestByRegion(insights);
  const measured = Object.keys(scores);
  const global = scores["Global"];

  // Only worth showing once there's a baseline (a Global score) to compare against.
  if (global == null) return null;

  const unmeasured = REGIONS.filter((r) => !(r in scores));

  async function measure(region: string) {
    if (running) return;
    setError(null);
    setRunning(region);
    const sess = getSessionId();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sess === "admin") headers["X-Admin-Key"] = getAdminKey();
    try {
      const res = await fetch(`${API}/audit/brands/${brandId}?session_id=${sess}`, {
        method: "POST", headers, body: JSON.stringify({ region }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.detail === "string" ? d.detail : "Couldn't start the regional audit.");
        setRunning(null);
        return;
      }
      // The audit runs in the background; reload shortly so the new region appears.
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      setError("Network error starting the regional audit.");
      setRunning(null);
    }
  }

  function color(pct: number) {
    return pct >= 60 ? "var(--green)" : pct >= 35 ? "var(--amber)" : "var(--red)";
  }

  return (
    <div className="card p-6">
      <div className="mb-1 flex items-center gap-2">
        <Globe className="w-4 h-4 text-[var(--accent)]" />
        <p className="text-slate-800 font-bold text-sm">Visibility by region</p>
      </div>
      <p className="text-slate-400 text-xs mb-5 leading-snug">
        The same brand can surface differently depending on which market the questions are framed for.
        Scores are a cross-model signal, not a guarantee of region-specific recall.
      </p>

      <div className="space-y-2">
        {measured.map((region) => {
          const pct = scores[region];
          const delta = region === "Global" ? null : pct - global;
          return (
            <div key={region} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-white">
              <span className="flex items-center gap-1.5 text-sm font-bold text-slate-700 w-40">
                {region === "Global" ? <Globe className="w-3.5 h-3.5 text-slate-400" /> : <MapPin className="w-3.5 h-3.5 text-slate-400" />}
                {region}
              </span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color(pct) }} />
              </div>
              <span className="text-sm font-extrabold tabular w-14 text-right" style={{ color: color(pct) }}>
                {pct.toFixed(1)}%
              </span>
              <span className="text-[11px] font-bold tabular w-12 text-right"
                style={{ color: delta == null ? "var(--text-3)" : delta > 0 ? "var(--green)" : delta < 0 ? "var(--red)" : "var(--text-3)" }}>
                {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
              </span>
            </div>
          );
        })}
      </div>

      {!isExample && unmeasured.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Measure another market</p>
          <div className="flex flex-wrap gap-2">
            {unmeasured.map((region) => (
              <button
                key={region}
                onClick={() => measure(region)}
                disabled={running !== null}
                className="text-xs font-semibold rounded-lg border border-slate-200 hover:border-[var(--accent)] hover:bg-[var(--accent-dim)] px-3 py-1.5 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {running === region ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3 text-slate-400" />}
                {region}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">Each market is a fresh audit (~30s).</p>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
}
