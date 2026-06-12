"use client";

import { useEffect, useRef, useState } from "react";

// Fade + slide a section up the first time it scrolls into view. Respects reduced-motion.
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(18px)",
        transition: `opacity 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// Count a number up from 0 to `value` when it first scrolls into view.
export function CountUp({
  value, decimals = 0, suffix = "", className = "", durationMs = 1100,
}: { value: number; decimals?: number; suffix?: string; className?: string; durationMs?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window === "undefined" || !window.matchMedia ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setDisplay(value); return; }

    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      const start = performance.now();
      const animate = (now: number) => {
        const t = Math.min((now - start) / durationMs, 1);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        setDisplay(value * eased);
        if (t < 1) requestAnimationFrame(animate);
        else setDisplay(value);
      };
      requestAnimationFrame(animate);
    };

    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { io.disconnect(); run(); }
    }, { threshold: 0.4 });
    io.observe(el);
    // Safety net: if the observer never fires (edge browsers / odd layout), the number
    // must still reach its real value — snap to it after a short delay.
    const fallback = setTimeout(() => { io.disconnect(); if (!done) setDisplay(value); }, 1500);
    return () => { io.disconnect(); clearTimeout(fallback); };
  }, [value, durationMs]);

  return <span ref={ref} className={className}>{display.toFixed(decimals)}{suffix}</span>;
}
