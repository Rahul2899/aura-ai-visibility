import "@testing-library/jest-dom";
import React from "react";

// jsdom doesn't implement matchMedia; our motion components (MagneticCursor, Reveal,
// CountUp) feature-detect pointer/reduced-motion through it. Mock it as "no fancy
// motion" so they render their final/static state in tests.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom lacks IntersectionObserver (used by Reveal/CountUp). Provide a stub that
// immediately reports the element as visible so animated content renders in tests.
if (!global.IntersectionObserver) {
  global.IntersectionObserver = class {
    constructor(cb) { this._cb = cb; }
    observe(el) { this._cb([{ isIntersecting: true, target: el }]); }
    unobserve() {}
    disconnect() {}
  };
}

// Mock recharts to avoid JSDOM SVG dimensions and layout rendering errors
jest.mock("recharts", () => {
  return {
    ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
    BarChart: ({ children, data }) => <svg data-testid="bar-chart" data-data={JSON.stringify(data)}>{children}</svg>,
    Bar: ({ children }) => <g data-testid="bar">{children}</g>,
    Cell: ({ fill }) => <rect data-testid="cell" data-fill={fill} />,
    LabelList: () => <g data-testid="label-list" />,
    AreaChart: ({ children, data }) => <svg data-testid="area-chart" data-data={JSON.stringify(data)}>{children}</svg>,
    Area: () => <path data-testid="area" />,
    XAxis: () => <g data-testid="x-axis" />,
    YAxis: () => <g data-testid="y-axis" />,
    Tooltip: () => <g data-testid="tooltip" />,
    CartesianGrid: () => <g data-testid="cartesian-grid" />,
  };
});
