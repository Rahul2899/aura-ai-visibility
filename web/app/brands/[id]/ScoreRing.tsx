"use client";

import { useEffect, useState } from "react";
import { Trophy, Medal, Award } from "lucide-react";

type Props = {
  pct: number;
  target?: number;
  rank?: number;
  total?: number;
};

export default function ScoreRing({ pct, target, rank, total }: Props) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    const duration = 800;
    const steps = 40;
    const increment = pct / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= pct) {
        setDisplayed(pct);
        clearInterval(timer);
      } else {
        setDisplayed(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [pct]);

  const label = pct >= 60 ? "Strong" : pct >= 35 ? "Moderate" : "Needs Work";
  const labelColorClass = pct >= 60 ? "text-emerald-600" : pct >= 35 ? "text-amber-500" : "text-red-500";
  const scoreColorClass = pct >= 60 ? "text-emerald-700" : pct >= 35 ? "text-amber-600" : "text-red-600";
  const gradientId = pct >= 60 ? "greenGrad" : pct >= 35 ? "amberGrad" : "redGrad";

  const nextMilestone = pct < 35 ? 35 : pct < 60 ? 60 : pct < 80 ? 80 : 100;
  const nextLabel = pct < 35 ? "Moderate" : pct < 60 ? "Strong" : pct < 80 ? "Strong" : "Perfect";
  const gap = nextMilestone - pct;

  const renderRankBadge = () => {
    if (!rank || !total) return null;

    let badgeClass = "bg-slate-100 border-slate-200 text-slate-500";
    let icon = <Award className="w-3.5 h-3.5" />;
    let text = `#${rank} of ${total} tracked brands`;

    if (rank === 1) {
      badgeClass = "bg-amber-50 border-amber-200 text-amber-700 shadow-sm";
      icon = <Trophy className="w-3.5 h-3.5 text-amber-500" />;
      text = `Market Leader (#1 of ${total})`;
    } else if (rank === 2) {
      badgeClass = "bg-slate-100 border-slate-300 text-slate-600 shadow-sm";
      icon = <Medal className="w-3.5 h-3.5 text-slate-500" />;
      text = `Runner Up (#2 of ${total})`;
    } else if (rank === 3) {
      badgeClass = "bg-orange-50 border-orange-200 text-orange-700 shadow-sm";
      icon = <Medal className="w-3.5 h-3.5 text-orange-500" />;
      text = `#3 of ${total} brands`;
    }

    return (
      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${badgeClass}`}>
        {icon}
        <span className="tabular">{text}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
      {/* Animated ring */}
      <div className="relative w-32 h-32 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-32 h-32 -rotate-90" aria-hidden="true">
          <defs>
            <linearGradient id="greenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6a9a6e" />
              <stop offset="100%" stopColor="#4e7a52" />
            </linearGradient>
            <linearGradient id="amberGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#c7a86c" />
              <stop offset="100%" stopColor="#b8893f" />
            </linearGradient>
            <linearGradient id="redGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#c66a62" />
              <stop offset="100%" stopColor="#b5524a" />
            </linearGradient>
          </defs>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ece6da" strokeWidth="2.5" />
          <circle cx="18" cy="18" r="15.9" fill="none" stroke={`url(#${gradientId})`} strokeWidth="3"
            strokeDasharray={`${displayed} ${100 - displayed}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.05s ease" }}
          />
          {target && target !== pct && (
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--accent)" strokeWidth="0.8"
              strokeDasharray={`0.5 ${target - 0.5} ${100 - target}`} strokeLinecap="round"
              strokeOpacity="0.5"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-extrabold tabular ${scoreColorClass}`}>{displayed}%</span>
          <span className={`text-[9px] uppercase font-bold tracking-wider mt-0.5 ${labelColorClass}`}>{label}</span>
        </div>
      </div>

      {/* Stats beside the ring */}
      <div className="flex flex-col gap-3 pt-1 text-center sm:text-left">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">AI Visibility Score</h2>
          <p className="text-slate-500 text-sm mt-1 leading-relaxed max-w-md font-semibold">
            Your brand appears in <span className={`font-extrabold tabular ${scoreColorClass}`}>{pct.toFixed(0)}</span>% of search completions across tested AI models.
          </p>
        </div>
        <div className="flex justify-center sm:justify-start">
          {renderRankBadge()}
        </div>
        {gap > 0 && (
          <div className="w-full sm:w-64">
            <div className="flex items-center justify-between mb-1.5 text-xs text-slate-400 font-semibold">
              <span>Next: {nextLabel} ({nextMilestone}%)</span>
              <span className="tabular">{gap.toFixed(0)}% away</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden border border-slate-300">
              <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-1000"
                style={{ width: `${Math.max(0, Math.min(100, ((pct - (nextMilestone - 25)) / 25) * 100))}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
