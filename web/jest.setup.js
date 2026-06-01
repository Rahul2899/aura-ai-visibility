import "@testing-library/jest-dom";
import React from "react";

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
