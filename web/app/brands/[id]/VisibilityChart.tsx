"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type DataPoint = { label: string; visibility: number };

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  const pct = payload[0].value;
  const color = pct >= 60 ? "#22c55e" : pct >= 35 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ background: "#0e0e18", border: "1px solid #2a2a40", borderRadius: 10, padding: "10px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
      <p style={{ color: "#8888a8", fontSize: 11, marginBottom: 3, letterSpacing: 0.3 }}>{label}</p>
      <p style={{ color, fontWeight: 700, fontSize: 18 }} className="tabular">{pct.toFixed(1)}%</p>
    </div>
  );
};

export default function VisibilityChart({ data }: { data: DataPoint[] }) {
  const latest = data[data.length - 1]?.visibility ?? 0;
  const color = latest >= 60 ? "#22c55e" : latest >= 35 ? "#f59e0b" : "#ef4444";

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
        <CartesianGrid strokeDasharray="3 3" stroke="#16161f" vertical={false} />
        <XAxis dataKey="label" stroke="#3a3a52" tick={{ fontSize: 11, fill: "#6a6a88" }} axisLine={false} tickLine={false} dy={6} />
        <YAxis domain={[0, 100]} stroke="#3a3a52" tick={{ fontSize: 11, fill: "#6a6a88" }} axisLine={false} tickLine={false} unit="%" width={38} />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "4 4", strokeOpacity: 0.4 }} />
        <Area
          type="monotone" dataKey="visibility"
          stroke={color} strokeWidth={2.5}
          fill="url(#visGrad)"
          dot={{ fill: "#0e0e18", stroke: color, strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, fill: color, stroke: "#0e0e18", strokeWidth: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
