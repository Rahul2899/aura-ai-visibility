"use client";

import { useEffect, useRef } from "react";

// A custom "magnetic" cursor: a blue ring that trails the pointer and grows + snaps
// toward elements marked data-magnetic (the hero CTA, links). Pure DOM/rAF, no deps.
// Disabled on touch devices and when the user prefers reduced motion. Scoped to the
// landing hero so it never interferes with the dense dashboard/table interactions.
export default function MagneticCursor() {
  const ringRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;

    const ring = ringRef.current!;
    let mx = window.innerWidth / 2, my = window.innerHeight / 2; // target
    let rx = mx, ry = my;                                        // rendered (eased)
    let scale = 1;
    let raf = 0;

    function onMove(e: MouseEvent) {
      mx = e.clientX; my = e.clientY;
      // Magnetize: if hovering a marked element, pull the ring toward its center.
      const el = (e.target as HTMLElement)?.closest("[data-magnetic]") as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        mx = r.left + r.width / 2;
        my = r.top + r.height / 2;
        scale = 2.4;
      } else {
        scale = 1;
      }
    }

    function tick() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%) scale(${scale})`;
      ring.style.opacity = "1";
      raf = requestAnimationFrame(tick);
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div
      ref={ringRef}
      aria-hidden="true"
      style={{
        position: "fixed", left: 0, top: 0, width: 28, height: 28,
        borderRadius: "9999px", border: "1.5px solid var(--accent)",
        pointerEvents: "none", zIndex: 60, opacity: 0,
        transition: "opacity 0.3s ease, scale 0.2s ease",
        mixBlendMode: "multiply",
      }}
    />
  );
}
