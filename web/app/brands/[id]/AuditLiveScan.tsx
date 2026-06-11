"use client";

import { useEffect, useRef } from "react";
import { Radar, Globe } from "lucide-react";

type Props = {
  brandName: string;
  probeCount: number;        // real resolved-probe count from the backend job
  total: number;             // expected probe count (typically 10)
  status: string;            // queued | running | completed | ...
  events: { t: number; msg: string }[];  // verbatim backend event feed
};

// A live "intelligence scan" for a running audit. Every visual element is bound to
// the REAL job state passed in — probeCount drives the lit nodes and the counter,
// and the log shows the backend's verbatim event messages. Nothing here fabricates
// progress: an idle/queued job shows a calm "establishing" state with zero lit nodes.
export default function AuditLiveScan({ brandName, probeCount, total, status, events }: Props) {
  const feedRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest event in view as the feed streams.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [events.length]);

  const establishing = status === "queued" || probeCount === 0;
  const lit = Math.max(0, Math.min(probeCount, total));   // never exceed total

  // Place `total` probe nodes evenly around the outer ring.
  const nodes = Array.from({ length: total }, (_, i) => {
    const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
    return {
      i,
      cx: 50 + 38 * Math.cos(angle),
      cy: 50 + 38 * Math.sin(angle),
      isLit: i < lit,
    };
  });

  // 4 model "satellites" orbiting; they pulse while the scan runs.
  const satellites = Array.from({ length: 4 }, (_, i) => {
    const angle = (i / 4) * 2 * Math.PI;
    return { i, cx: 50 + 26 * Math.cos(angle), cy: 50 + 26 * Math.sin(angle) };
  });

  const pct = Math.round((lit / total) * 100);

  return (
    <div className="w-[min(92vw,640px)] rounded-2xl p-5 border shadow-2xl"
      style={{ background: "var(--surface-solid)", borderColor: "var(--border-solid)" }}
      role="status" aria-live="polite">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-[var(--accent)]" />
          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
            Scanning AI models for <span className="text-[var(--accent-2)]">{brandName}</span>
          </span>
        </div>
        <span className="text-[11px] font-bold tabular px-2 py-1 rounded-lg"
          style={{ background: "var(--accent-dim)", color: "var(--accent-2)" }}>
          {lit} / {total} probes
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-5">
        {/* The radar instrument */}
        <div className="relative w-40 h-40 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-40 h-40">
            <defs>
              <radialGradient id="scanGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="sweepGrad" x1="50%" y1="50%" x2="100%" y2="50%">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* concentric brass rings */}
            <circle cx="50" cy="50" r="46" fill="url(#scanGlow)" />
            {[46, 34, 22].map(r => (
              <circle key={r} cx="50" cy="50" r={r} fill="none"
                stroke="var(--border-2-solid)" strokeWidth="0.5" />
            ))}
            <line x1="4" y1="50" x2="96" y2="50" stroke="var(--border-2-solid)" strokeWidth="0.4" />
            <line x1="50" y1="4" x2="50" y2="96" stroke="var(--border-2-solid)" strokeWidth="0.4" />

            {/* sweeping scan line — only animates while running */}
            {!establishing && (
              <g className="scan-sweep" style={{ transformOrigin: "50px 50px" }}>
                <path d="M50 50 L96 50 A46 46 0 0 1 82.5 82.5 Z" fill="url(#sweepGrad)" />
              </g>
            )}

            {/* model satellites */}
            {satellites.map(s => (
              <circle key={s.i} cx={s.cx} cy={s.cy} r="2.4"
                fill="var(--accent-2)" opacity={establishing ? 0.25 : 0.85}
                className={establishing ? "" : "scan-pulse"} />
            ))}

            {/* probe nodes */}
            {nodes.map(n => (
              <circle
                key={n.i}
                {...(n.isLit ? { "data-testid": "scan-node-lit" } : {})}
                cx={n.cx} cy={n.cy} r={n.isLit ? 2.6 : 1.6}
                fill={n.isLit ? "var(--accent)" : "var(--border-2-solid)"}
                style={n.isLit ? { filter: "drop-shadow(0 0 3px var(--accent-glow))" } : undefined}
              />
            ))}

            {/* center reticle */}
            <circle cx="50" cy="50" r="3" fill="var(--accent)" opacity="0.9" />
          </svg>

          {/* live % in the middle */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-extrabold tabular" style={{ color: "var(--accent-2)" }}>{pct}%</span>
            <span className="text-[8px] uppercase font-bold tracking-wider" style={{ color: "var(--text-3)" }}>visibility</span>
          </div>
        </div>

        {/* Intercepted-feed log — verbatim backend events */}
        <div className="flex-1 min-w-0 w-full">
          {establishing ? (
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-2)" }}>
              <Globe className="w-4 h-4 animate-spin text-[var(--accent)]" style={{ animationDuration: "2.5s" }} />
              Establishing connection to AI models…
            </div>
          ) : (
            <div ref={feedRef} className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
              {events.length === 0 ? (
                <span className="text-xs mono" style={{ color: "var(--text-3)" }}>&gt; awaiting first signal…</span>
              ) : (
                events.map((e, i) => {
                  const done = /✓|complete|found|mention/i.test(e.msg);
                  return (
                    <span key={i} className="text-xs mono leading-relaxed tracking-tight"
                      style={{ color: done ? "var(--green)" : "var(--text-2)" }}>
                      {done ? "✔ " : "▸ "}{e.msg}
                    </span>
                  );
                })
              )}
            </div>
          )}

          {/* progress rail */}
          <div className="mt-3 w-full rounded-full h-1.5 overflow-hidden" style={{ background: "var(--surface-2-solid)" }}>
            <div className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${Math.min(pct, 96)}%`, background: "linear-gradient(90deg, var(--accent-2), var(--accent))" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
