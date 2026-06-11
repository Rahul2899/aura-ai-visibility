import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Aura AI — Brand Visibility Report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Server-side the Next container reaches the API on the internal Docker network; the
// browser-facing NEXT_PUBLIC_API_URL (/api) is not a valid server fetch target.
const SERVER_API = process.env.INTERNAL_API_URL ?? "http://app:8000";

function tone(pct: number) {
  if (pct >= 60) return "#1f8a5b";
  if (pct >= 35) return "#c08321";
  return "#d2453f";
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  // Next 16: route params are async — must be awaited before use.
  const { token } = await params;
  let brand = "Your brand";
  let pct: number | null = null;
  let probes = 0;
  try {
    const r = await fetch(`${SERVER_API}/brands/share/${token}`, { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      brand = d.brand ?? brand;
      pct = d.insight?.visibility_pct ?? null;
      probes = d.insight?.probe_count ?? 0;
    }
  } catch {
    // fall back to the generic card below
  }

  const scoreColor = pct === null ? "#8a90a2" : tone(pct);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          background: "#f6f7f9", padding: "72px", justifyContent: "space-between",
          fontFamily: "Georgia, serif", position: "relative",
        }}
      >
        {/* brand mark */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "#1863dc", display: "flex" }} />
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#16181f", letterSpacing: -1 }}>Aura AI</div>
          <div style={{ display: "flex", fontSize: 22, color: "#8a90a2", marginLeft: 6 }}>· AI Brand Visibility</div>
        </div>

        {/* the score */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 40, color: "#4e4b66", marginBottom: 8 }}>How often AI recommends</div>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, color: "#16181f", letterSpacing: -2, lineHeight: 1 }}>{brand}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 24, marginTop: 28 }}>
            <div style={{ display: "flex", fontSize: 140, fontWeight: 700, color: scoreColor, lineHeight: 0.9 }}>
              {pct === null ? "—" : `${Math.round(pct)}%`}
            </div>
            <div style={{ display: "flex", fontSize: 30, color: "#4e4b66", marginBottom: 22 }}>
              visibility across AI models
            </div>
          </div>
        </div>

        {/* footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "2px solid #e4e7ee", paddingTop: 24 }}>
          <div style={{ display: "flex", fontSize: 24, color: "#8a90a2" }}>{probes} buyer questions · 4 AI models</div>
          <div style={{ display: "flex", fontSize: 24, color: "#1863dc", fontWeight: 700 }}>Seen by AI?</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
