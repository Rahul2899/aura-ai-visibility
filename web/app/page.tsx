"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import ComparisonChart from "./components/ComparisonChart";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function exportCSV(brands: BrandRow[]) {
  const rows = [
    ["Brand", "Domain", "AI Visibility %", "vs Last Run", "Probes", "Last Audit"],
    ...brands.map(b => [
      b.name,
      b.domain ?? "",
      b.visibility_pct?.toFixed(1) ?? "",
      b.trend !== null ? `${b.trend > 0 ? "+" : ""}${b.trend?.toFixed(1)}%` : "",
      b.probe_count ?? "",
      b.last_run ? new Date(b.last_run).toLocaleDateString() : "",
    ])
  ];
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ai-visibility-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}

type BrandRow = {
  id: number; name: string; domain: string | null;
  visibility_pct: number | null; trend: number | null;
  probe_count: number; last_run: string | null; rank?: number;
};

function suggestDomain(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "") + ".com";
}

function ScoreChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-zinc-600">No data</span>;
  const col = pct >= 60 ? "text-emerald-400" : pct >= 35 ? "text-amber-400" : "text-red-400";
  return <span className={`text-xl font-bold tabular ${col}`}>{pct.toFixed(0)}%</span>;
}

function TrendPill({ v }: { v: number | null }) {
  if (v === null || v === 0) return <span className="text-zinc-600 text-xs">—</span>;
  const up = v > 0;
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${up ? "bg-emerald-950 text-emerald-400" : "bg-red-950 text-red-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%
    </span>
  );
}

export default function Home() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/brands/compare`);
      if (res.ok) setBrands(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    const res = await fetch(`${API}/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), domain: domain.trim() || suggestion }),
    });
    const brand = await res.json();
    // Navigate with autostart flag — the brand page kicks off the audit and shows live progress.
    // (Starting it here AND there would run two concurrent audits.)
    window.location.href = `/brands/${brand.id}?autostart=1`;
  }

  async function deleteBrand(id: number) {
    if (!confirm("Delete this brand and all its data?")) return;
    setDeleting(id);
    await fetch(`${API}/brands/${id}`, { method: "DELETE" });
    setDeleting(null);
    load();
  }

  const filtered = search
    ? brands.filter(b => b.name.toLowerCase().includes(search.toLowerCase()))
    : brands;
  const audited = filtered.filter(b => b.visibility_pct !== null);
  const allAudited = brands.filter(b => b.visibility_pct !== null);
  const avg = allAudited.length ? allAudited.reduce((s, b) => s + (b.visibility_pct ?? 0), 0) / allAudited.length : null;
  const best = allAudited[0] ?? null;
  const pending = filtered.filter(b => b.visibility_pct === null);

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Top nav */}
      <header className="border-b px-8 py-4 flex items-center justify-between" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
            <span className="text-white text-xs font-bold">AI</span>
          </div>
          <span className="font-semibold text-sm">AI Visibility Tracker</span>
        </div>
        <span className="text-zinc-500 text-xs">by Peec Clone</span>
      </header>

      <div className="max-w-5xl mx-auto px-8 py-8">

        {/* Summary stats */}
        {audited.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: "Brands Tracked", value: brands.length.toString(), sub: `${audited.length} audited` },
              { label: "Avg AI Visibility", value: avg !== null ? `${avg.toFixed(0)}%` : "—", sub: "across all brands", colored: avg },
              { label: "Market Leader", value: best?.name ?? "—", sub: best ? `${best.visibility_pct?.toFixed(0)}% visibility` : "", colored: best?.visibility_pct },
            ].map(({ label, value, sub, colored }) => (
              <div key={label} className="rounded-xl p-5 border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">{label}</p>
                <p className={`text-2xl font-bold ${colored !== undefined && colored !== null ? (colored >= 60 ? "text-emerald-400" : colored >= 35 ? "text-amber-400" : "text-red-400") : "text-white"}`}>
                  {value}
                </p>
                <p className="text-zinc-600 text-xs mt-1">{sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Search + actions bar */}
        {brands.length > 0 && (
          <div className="flex items-center gap-3 mb-6">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search brands..."
              className="flex-1 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:ring-1 focus:ring-indigo-500"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            />
            <Link href="/compare"
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white border hover:border-zinc-600 transition-colors"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              ⚔ Compare
            </Link>
            {audited.length > 0 && (
              <button onClick={() => exportCSV(audited)}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white border hover:border-zinc-600 transition-colors"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                ↓ Export CSV
              </button>
            )}
          </div>
        )}

        {/* Race chart */}
        {audited.length > 1 && (
          <div className="rounded-xl border p-6 mb-8" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-semibold">Competitive Race</h2>
                <p className="text-zinc-500 text-xs mt-0.5">AI visibility across all tracked brands</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-600">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Strong (60%+)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Moderate</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Needs work</span>
              </div>
            </div>
            <ComparisonChart brands={audited} />
          </div>
        )}

        {/* Brand table */}
        {loading ? (
          <div className="rounded-xl border p-12 text-center text-zinc-600 text-sm" style={{ borderColor: "var(--border)", borderStyle: "dashed" }}>
            Loading brands...
          </div>
        ) : audited.length === 0 ? (
          <div className="rounded-xl border p-12 text-center" style={{ borderColor: "var(--border)", borderStyle: "dashed" }}>
            <p className="text-zinc-400 font-medium mb-1">No audits yet</p>
            <p className="text-zinc-600 text-sm">Add a brand below, open it, and click "Run Audit"</p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden mb-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="grid grid-cols-12 px-5 py-3 text-zinc-600 text-xs uppercase tracking-wide border-b" style={{ borderColor: "var(--border)" }}>
              <div className="col-span-1">#</div>
              <div className="col-span-4">Brand</div>
              <div className="col-span-2 text-right">Visibility</div>
              <div className="col-span-2 text-right">Change</div>
              <div className="col-span-2 text-right">Probes</div>
              <div className="col-span-1 text-right">→</div>
            </div>
            {audited.map((b, i) => (
              <Link key={b.id} href={`/brands/${b.id}`}>
                <div className={`group grid grid-cols-12 px-5 py-4 items-center hover:bg-zinc-900/50 transition-colors cursor-pointer ${i < audited.length - 1 ? "border-b" : ""}`} style={{ borderColor: "var(--border)" }}>
                  <div className="col-span-1">
                    <span className={`text-sm font-bold ${i === 0 ? "text-indigo-400" : "text-zinc-600"}`}>
                      {i === 0 ? "🏆" : `${i + 1}`}
                    </span>
                  </div>
                  <div className="col-span-4">
                    <p className="font-medium text-sm">{b.name}</p>
                    {b.domain && <p className="text-zinc-600 text-xs mt-0.5">{b.domain}</p>}
                  </div>
                  <div className="col-span-2 text-right"><ScoreChip pct={b.visibility_pct} /></div>
                  <div className="col-span-2 text-right"><TrendPill v={b.trend} /></div>
                  <div className="col-span-2 text-right"><span className="text-zinc-500 text-sm">{b.probe_count ?? "—"}</span></div>
                  <div className="col-span-1 text-right flex items-center justify-end gap-2">
                    <button onClick={e => { e.preventDefault(); deleteBrand(b.id); }}
                      disabled={deleting === b.id}
                      className="text-zinc-700 hover:text-red-400 text-xs transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete brand">✕</button>
                    <span className="text-zinc-700 text-sm">→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pending brands */}
        {pending.length > 0 && (
          <div className="flex flex-col gap-2 mb-6">
            {pending.map(b => (
              <Link key={b.id} href={`/brands/${b.id}`}>
                <div className="rounded-xl border px-5 py-3 flex items-center justify-between hover:border-zinc-700 transition-colors cursor-pointer" style={{ borderColor: "var(--border)", borderStyle: "dashed" }}>
                  <span className="text-zinc-400 text-sm font-medium">{b.name}</span>
                  <span className="text-zinc-600 text-xs">Run first audit →</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Add brand */}
        <div className="rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <p className="text-zinc-400 text-sm font-medium mb-3">Track a new brand</p>
          <form onSubmit={addBrand} className="flex flex-col gap-2">
            <div className="flex gap-3">
              <input value={name} onChange={e => setName(e.target.value)}
                onBlur={() => { if (name.trim() && !domain) setSuggestion(suggestDomain(name)); }}
                placeholder="Brand name (e.g. Salesforce)"
                className="flex-1 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:ring-1 focus:ring-indigo-500"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
              <input value={domain} onChange={e => { setDomain(e.target.value); setSuggestion(""); }}
                placeholder={suggestion || "domain.com"}
                className="w-44 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:ring-1 focus:ring-indigo-500"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
              <button type="submit" disabled={adding || !name.trim()}
                className="px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
                style={{ background: adding || !name.trim() ? "#27272a" : "var(--accent)" }}
              >
                {adding ? "Starting audit..." : "Add & Audit →"}
              </button>
            </div>
            {suggestion && !domain && (
              <p className="text-zinc-600 text-xs pl-1">
                Suggested domain:{" "}
                <button type="button" onClick={() => { setDomain(suggestion); setSuggestion(""); }}
                  className="text-indigo-400 hover:text-indigo-300 underline">{suggestion}</button>
              </p>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}
