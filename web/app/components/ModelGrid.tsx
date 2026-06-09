"use client";

import { friendlyName, providerKey } from "../lib/models";

type Model = { model: string; visibility_pct: number; avg_latency_ms?: number | null };

const PROVIDER_THEMES: Record<string, { label: string; badgeClass: string; dotClass: string }> = {
  amazon: {
    label: "Amazon",
    badgeClass: "border-amber-500/20 bg-amber-500/5 text-amber-400",
    dotClass: "bg-amber-400",
  },
  anthropic: {
    label: "Anthropic",
    badgeClass: "border-orange-500/20 bg-orange-500/5 text-orange-400",
    dotClass: "bg-orange-500",
  },
  meta: {
    label: "Meta",
    badgeClass: "border-blue-500/20 bg-blue-500/5 text-blue-400",
    dotClass: "bg-blue-500",
  },
  google: {
    label: "Google",
    badgeClass: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    dotClass: "bg-emerald-400",
  },
  openai: {
    label: "OpenAI",
    badgeClass: "border-slate-300 bg-slate-100 text-slate-600",
    dotClass: "bg-slate-400",
  },
  qwen: {
    label: "Qwen",
    badgeClass: "border-purple-500/20 bg-purple-500/5 text-purple-500",
    dotClass: "bg-purple-500",
  },
  nvidia: {
    label: "NVIDIA",
    badgeClass: "border-green-600/20 bg-green-600/5 text-green-600",
    dotClass: "bg-green-600",
  },
  generic: {
    label: "AI Model",
    badgeClass: "border-slate-300 bg-slate-100 text-slate-500",
    dotClass: "bg-slate-400",
  },
};

function LatencyBadge({ ms }: { ms: number | null | undefined }) {
  if (!ms) return null;
  const label = ms < 2000 ? "Fast" : ms < 5000 ? "Moderate" : "Slow";
  const cls =
    ms < 2000
      ? "text-emerald-600 bg-emerald-50 border-emerald-200"
      : ms < 5000
      ? "text-amber-600 bg-amber-50 border-amber-200"
      : "text-red-600 bg-red-50 border-red-200";
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>
      {label} · {(ms / 1000).toFixed(1)}s
    </span>
  );
}

export default function ModelGrid({ models }: { models: Model[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="region" aria-label="Model performance metrics">
      {models.map(({ model, visibility_pct, avg_latency_ms }) => {
        const pct = visibility_pct;
        const scoreColor = pct >= 60 ? "var(--green)" : pct >= 35 ? "var(--amber)" : "var(--red)";
        const key = providerKey(model);
        const theme = PROVIDER_THEMES[key] || PROVIDER_THEMES.generic;

        return (
          <div
            key={model}
            className="rounded-xl p-4 border transition-all duration-300 hover:border-slate-300"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${theme.badgeClass} flex items-center gap-1.5`}>
                <span className={`w-1.5 h-1.5 rounded-full ${theme.dotClass}`} />
                {theme.label}
              </span>
              <span className="text-xl font-bold tabular" style={{ color: scoreColor }}>
                {pct.toFixed(0)}%
              </span>
            </div>
            <p className="text-slate-700 text-xs font-semibold leading-snug">{friendlyName(model)}</p>
            <div className="mt-1">
              <LatencyBadge ms={avg_latency_ms} />
            </div>
            <div className="mt-3 w-full rounded-full h-1.5 bg-slate-100 overflow-hidden" style={{ border: "1px solid var(--border-solid)" }}>
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${pct}%`, backgroundColor: scoreColor }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
