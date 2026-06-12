"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type DataPoint = { label: string; visibility: number };

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  const pct = payload[0].value;
  const color = pct >= 60 ? "var(--green)" : pct >= 35 ? "var(--amber)" : "var(--red)";
  return (
    <div className="card p-3 shadow-xl" style={{ minWidth: 120 }}>
      <p className="text-xs text-slate-400 font-medium mb-1">{label}</p>
      <p className="text-lg font-bold tabular" style={{ color }}>{pct.toFixed(1)}%</p>
    </div>
  );
};

export default function VisibilityChart({ data }: { data: DataPoint[] }) {
  const latest = data[data.length - 1]?.visibility ?? 0;
  // Muted score tones tuned to the editorial-blue palette (no neon).
  const color = latest >= 60 ? "#1f8a5b" : latest >= 35 ? "#c08321" : "#d2453f";

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="visGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="60%" stopColor={color} stopOpacity={0.08} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e7ee" vertical={false} />
        <XAxis dataKey="label" stroke="#d2d7e1" tick={{ fontSize: 11, fill: "#8a90a2" }} axisLine={false} tickLine={false} dy={6} />
        <YAxis domain={[0, 100]} stroke="#d2d7e1" tick={{ fontSize: 11, fill: "#8a90a2" }} axisLine={false} tickLine={false} unit="%" width={38} />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "4 4", strokeOpacity: 0.4 }} />
        <Area
          type="monotone" dataKey="visibility"
          stroke={color} strokeWidth={2.5}
          fill="url(#visGrad)"
          dot={{ fill: "#ffffff", stroke: color, strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, fill: color, stroke: "#ffffff", strokeWidth: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
