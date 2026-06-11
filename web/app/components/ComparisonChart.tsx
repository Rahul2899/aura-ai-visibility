"use client";

type Brand = { name: string; visibility_pct: number | null; id: number };

// Warm, muted score tones — matches the luxury palette (no neon).
function color(pct: number) {
  if (pct >= 60) return "#4e7a52";
  if (pct >= 35) return "#b8893f";
  return "#b5524a";
}

// A horizontal ranking of brands by AI visibility. This is just labelled progress
// bars, so it's plain CSS rather than a charting library: Recharts 3.x computed a
// width=0 x-scale for this vertical BarChart (invisible bars), and divs render
// reliably in every environment (SSR, jsdom tests, headless screenshots) with no
// layout-measurement race. Mirrors the bar pattern already used on the brand page.
export default function ComparisonChart({ brands }: { brands: Brand[] }) {
  const data = brands
    .filter(b => b.visibility_pct !== null)
    .sort((a, b) => (b.visibility_pct ?? 0) - (a.visibility_pct ?? 0))
    .map(b => ({ name: b.name, pct: b.visibility_pct ?? 0 }));

  if (data.length === 0) return null;

  const chartSummary = `Horizontal bar chart showing AI visibility ranking. ` +
    data.map(d => `${d.name}: ${Math.round(d.pct)}%`).join(", ");

  return (
    <div className="relative w-full space-y-3.5" aria-label="Competitive visibility chart" role="img">
      <span className="sr-only">{chartSummary}</span>
      {data.map(d => {
        const c = color(d.pct);
        // Keep a 0% bar visible as a 2% sliver so its label reads as a real bar.
        const width = `${Math.max(d.pct, 2)}%`;
        return (
          <div key={d.name} data-testid="comparison-row" className="flex items-center gap-3">
            <span data-testid="comparison-name"
              className="w-28 flex-shrink-0 text-sm font-medium truncate text-right"
              style={{ color: "var(--text-2)" }}>
              {d.name}
            </span>
            <div className="flex-1 h-7 rounded-md overflow-hidden" style={{ background: "var(--surface-2)" }}>
              <div data-testid="comparison-fill"
                className="h-full rounded-md transition-[width] duration-700 ease-out"
                style={{ width, background: c }} />
            </div>
            <span className="w-10 flex-shrink-0 text-xs font-bold tabular" style={{ color: c }}>
              {Math.round(d.pct)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
