"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { Sparkles, ArrowUp, ArrowDown } from "lucide-react";
import { friendlyName, providerKey } from "../../lib/models";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Report = {
  brand: string;
  industry: string | null;
  insight: {
    visibility_pct: number;
    summary: string;
    key_findings: string[];
    recommendations: string[];
    model_breakdown: Record<string, number>;
    probe_count: number;
    created_at: string;
  } | null;
};

const DOT: Record<string, string> = {
  amazon: "bg-amber-500", anthropic: "bg-orange-500", meta: "bg-blue-500",
  google: "bg-emerald-500", openai: "bg-slate-400", generic: "bg-slate-400",
};

export default function SharedReportPage() {
  const { token } = useParams();
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");

  useEffect(() => {
    fetch(`${API}/brands/share/${token}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { setReport(d); setState("ok"); })
      .catch(() => setState("notfound"));
  }, [token]);

  if (state === "loading") {
    return <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <p className="text-slate-400 text-sm font-semibold">Loading report…</p>
    </main>;
  }

  if (state === "notfound" || !report) {
    return <main className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: "var(--bg)" }}>
      <p className="text-slate-700 font-bold">This shared report isn&apos;t available.</p>
      <p className="text-slate-400 text-sm">The link may be invalid or was revoked.</p>
    </main>;
  }

  const ins = report.insight;
  const pct = ins?.visibility_pct ?? 0;
  const tone = pct >= 60 ? "text-emerald-600" : pct >= 35 ? "text-amber-600" : "text-red-600";

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      <header className="border-b px-8 py-4 flex items-center gap-3" style={{ borderColor: "var(--border-solid)", background: "rgba(255,255,255,0.95)" }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--accent)]">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-sm text-slate-900">Aura AI — Shared Report</span>
        <span className="ml-auto text-[10px] uppercase font-bold tracking-wider text-slate-400 border border-slate-200 bg-slate-50 px-2.5 py-1 rounded-lg">Read-only</span>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{report.brand}</h1>
          {report.industry && <p className="text-slate-400 text-sm font-semibold mt-0.5">{report.industry.split("/")[0].trim()}</p>}
        </div>

        {!ins ? (
          <div className="card p-10 text-center text-slate-500 font-semibold">No audit data available for this brand yet.</div>
        ) : (
          <>
            <div className="card p-8 text-center">
              <p className="text-[11px] uppercase font-bold tracking-wider text-slate-400">AI Visibility Score</p>
              <p className={`text-6xl font-extrabold mt-2 ${tone}`}>{pct.toFixed(0)}%</p>
              <p className="text-slate-500 text-sm font-semibold mt-2 max-w-md mx-auto">{ins.summary}</p>
              <p className="text-[11px] text-slate-400 mt-3">{ins.probe_count} probes · {new Date(ins.created_at).toLocaleDateString()}</p>
            </div>

            {ins.key_findings.length > 0 && (
              <div className="card p-6">
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-4">Key Findings</p>
                <div className="space-y-3">
                  {ins.key_findings.map((f, i) => {
                    const bad = /0%|drops|invisible|weak/i.test(f);
                    return <div key={i} className="flex items-start gap-2.5">
                      {bad ? <ArrowDown className="w-4 h-4 mt-0.5 text-red-500 bg-red-50 p-0.5 rounded flex-shrink-0" />
                           : <ArrowUp className="w-4 h-4 mt-0.5 text-emerald-600 bg-emerald-50 p-0.5 rounded flex-shrink-0" />}
                      <p className="text-sm text-slate-700 font-semibold leading-relaxed">{f}</p>
                    </div>;
                  })}
                </div>
              </div>
            )}

            {Object.keys(ins.model_breakdown).length > 0 && (
              <div className="card p-6">
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-4">Model Breakdown</p>
                <div className="space-y-3">
                  {Object.entries(ins.model_breakdown).sort((a, b) => b[1] - a[1]).map(([model, v]) => (
                    <div key={model}>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-xs font-semibold text-slate-600 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${DOT[providerKey(model)] ?? DOT.generic}`} />
                          {friendlyName(model)}
                        </span>
                        <span className="text-xs font-bold tabular text-slate-700">{v}%</span>
                      </div>
                      <div className="w-full rounded-full h-1.5 bg-slate-100">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${v}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-center text-[11px] text-slate-400 pt-4">
          Generated by <span className="font-bold text-slate-500">Aura AI</span> — AI brand visibility analytics
        </p>
      </div>
    </main>
  );
}
