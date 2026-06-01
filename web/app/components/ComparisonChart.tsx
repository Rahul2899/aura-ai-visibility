"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";

type Brand = { name: string; visibility_pct: number | null; id: number };

function color(pct: number) {
  if (pct >= 60) return "#22c55e";
  if (pct >= 35) return "#f59e0b";
  return "#ef4444";
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: { name: string; pct: number } }[] }) => {
  if (!active || !payload?.length) return null;
  const { name, pct } = payload[0].payload;
  return (
    <div className="card p-3 shadow-xl border-zinc-800" style={{ minWidth: 120 }}>
      <p className="text-xs text-zinc-400 font-medium mb-1">{name}</p>
      <p className="text-lg font-bold tabular" style={{ color: color(pct) }}>{pct.toFixed(1)}%</p>
    </div>
  );
};

export default function ComparisonChart({ brands }: { brands: Brand[] }) {
  const data = brands
    .filter(b => b.visibility_pct !== null)
    .sort((a, b) => (b.visibility_pct ?? 0) - (a.visibility_pct ?? 0))
    .map(b => ({ name: b.name, pct: b.visibility_pct ?? 0 }));

  if (data.length === 0) return null;

  const chartSummary = `Horizontal bar chart showing AI visibility ranking. ` +
    data.map(d => `${d.name}: ${Math.round(d.pct)}%`).join(", ");

  return (
    <div className="relative w-full" aria-label="Competitive visibility chart" role="img">
      <span className="sr-only">{chartSummary}</span>
      <ResponsiveContainer width="100%" height={data.length * 54 + 16}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 48, top: 0, bottom: 0 }} barCategoryGap={14}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis type="category" dataKey="name" width={110}
            tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 500 }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(92,110,245,0.04)" }} />
          <Bar dataKey="pct" radius={[0, 6, 6, 0]} background={{ fill: "var(--surface-2)", radius: 6 }}>
            {data.map((entry, i) => (
              <Cell key={i} fill={color(entry.pct)} />
            ))}
            <LabelList dataKey="pct" position="right"
              formatter={(v: unknown) => `${Math.round(Number(v))}%`}
              style={{ fill: "var(--text-2)", fontSize: 12, fontWeight: 700 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
