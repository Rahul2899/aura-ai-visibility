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
    <div style={{ background: "#0e0e18", border: "1px solid #2a2a40", borderRadius: 10, padding: "8px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
      <p style={{ color: "#8888a8", fontSize: 11, marginBottom: 2 }}>{name}</p>
      <p style={{ color: color(pct), fontWeight: 700, fontSize: 16 }} className="tabular">{pct.toFixed(1)}%</p>
    </div>
  );
};

export default function ComparisonChart({ brands }: { brands: Brand[] }) {
  const data = brands
    .filter(b => b.visibility_pct !== null)
    .sort((a, b) => (b.visibility_pct ?? 0) - (a.visibility_pct ?? 0))
    .map(b => ({ name: b.name, pct: b.visibility_pct ?? 0 }));

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={data.length * 54 + 16}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 48, top: 0, bottom: 0 }} barCategoryGap={14}>
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis type="category" dataKey="name" width={110}
          tick={{ fill: "#c8c8d8", fontSize: 13, fontWeight: 500 }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(92,110,245,0.06)" }} />
        <Bar dataKey="pct" radius={[0, 7, 7, 0]} background={{ fill: "#14141f", radius: 7 }}>
          {data.map((entry, i) => (
            <Cell key={i} fill={color(entry.pct)} />
          ))}
          <LabelList dataKey="pct" position="right"
            formatter={(v: unknown) => `${Math.round(Number(v))}%`}
            style={{ fill: "#c8c8d8", fontSize: 12, fontWeight: 700 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
