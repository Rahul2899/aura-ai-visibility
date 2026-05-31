"use client";

import { friendlyName, providerIcon } from "../lib/models";

type Model = { model: string; visibility_pct: number };

export default function ModelGrid({ models }: { models: Model[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {models.map(({ model, visibility_pct }) => {
        const pct = visibility_pct;
        const color = pct >= 60 ? "#10b981" : pct >= 35 ? "#f59e0b" : "#ef4444";
        const bg = pct >= 60 ? "rgba(16,185,129,0.08)" : pct >= 35 ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)";
        return (
          <div key={model} className="rounded-xl p-4 border" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm">{providerIcon(model)}</span>
              <span className="text-xl font-bold tabular" style={{ color }}>{pct.toFixed(0)}%</span>
            </div>
            <p className="text-zinc-400 text-xs leading-tight">{friendlyName(model)}</p>
            <div className="mt-2 w-full rounded-full h-1" style={{ background: "var(--border)" }}>
              <div className="h-1 rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
