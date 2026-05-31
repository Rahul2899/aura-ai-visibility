"use client";

import { useEffect, useState } from "react";

type Props = {
  pct: number;
  target?: number; // goal %
  rank?: number;   // position among tracked brands
  total?: number;  // total brands tracked
};

export default function ScoreRing({ pct, target, rank, total }: Props) {
  const [displayed, setDisplayed] = useState(0);

  // Count up animation on mount
  useEffect(() => {
    const duration = 1200;
    const steps = 60;
    const increment = pct / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= pct) { setDisplayed(pct); clearInterval(timer); }
      else setDisplayed(Math.floor(current));
    }, duration / steps);
    return () => clearInterval(timer);
  }, [pct]);

  const color = pct >= 60 ? "#4ade80" : pct >= 35 ? "#facc15" : "#f87171";
  const label = pct >= 60 ? "Strong" : pct >= 35 ? "Moderate" : "Needs Work";
  const nextMilestone = pct < 35 ? 35 : pct < 60 ? 60 : pct < 80 ? 80 : 100;
  const nextLabel = pct < 35 ? "Moderate" : pct < 60 ? "Good" : pct < 80 ? "Strong" : "Perfect";
  const gap = nextMilestone - pct;

  return (
    <div className="flex items-start gap-8">
      {/* Animated ring */}
      <div className="relative w-32 h-32 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-32 h-32 -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1f2937" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="3"
            strokeDasharray={`${displayed} ${100 - displayed}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.1s ease" }}
          />
          {/* Target marker */}
          {target && target !== pct && (
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3b82f6" strokeWidth="1"
              strokeDasharray={`0.5 ${target - 0.5} ${100 - target}`} strokeLinecap="round"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white tabular-nums">{displayed}%</span>
          <span className="text-xs mt-0.5" style={{ color }}>{label}</span>
        </div>
      </div>

      {/* Stats beside the ring */}
      <div className="flex flex-col gap-3 pt-1">
        <div>
          <p className="text-2xl font-bold text-white">AI Visibility Score</p>
          <p className="text-gray-500 text-sm mt-0.5">
            Your brand appears in <span className="text-white font-medium">{pct.toFixed(0)} out of 100</span> AI responses about your category
          </p>
        </div>

        {/* Rank badge */}
        {rank && total && (
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold px-3 py-1 rounded-full ${rank === 1 ? "bg-yellow-900 text-yellow-300 border border-yellow-700" : rank === 2 ? "bg-gray-700 text-gray-200 border border-gray-600" : "bg-gray-800 text-gray-400 border border-gray-700"}`}>
              {rank === 1 ? "🏆" : rank === 2 ? "🥈" : "🥉"} #{rank} of {total} tracked brands
            </span>
          </div>
        )}

        {/* Next milestone */}
        {gap > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-500 text-xs">Next: {nextLabel} ({nextMilestone}%)</span>
              <span className="text-gray-500 text-xs">{gap.toFixed(1)} points away</span>
            </div>
            <div className="w-64 bg-gray-800 rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-blue-500 transition-all duration-1000"
                style={{ width: `${((pct - (nextMilestone - 25)) / 25) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
