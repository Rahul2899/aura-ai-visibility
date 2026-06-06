import React from "react";
import { render, screen, act } from "@testing-library/react";
import ScoreRing from "../app/brands/[id]/ScoreRing";

describe("ScoreRing Component", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("animates the score count up on mount", () => {
    render(<ScoreRing pct={45} />);

    // Starts at 0
    expect(screen.getByText("0%")).toBeInTheDocument();

    // Fast-forward animation
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
  });

  it("determines correct label based on percentage thresholds", () => {
    const { rerender } = render(<ScoreRing pct={75} />);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText("Strong")).toBeInTheDocument();

    rerender(<ScoreRing pct={20} />);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText("Needs Work")).toBeInTheDocument();
  });

  it("renders rank indicator if provided", () => {
    render(<ScoreRing pct={60} rank={1} total={5} />);
    act(() => { jest.advanceTimersByTime(1000); });

    expect(screen.getByText(/Market Leader \(#1 of 5\)/)).toBeInTheDocument();
  });

  it("calculates correct distance to next milestone", () => {
    render(<ScoreRing pct={50} />); // milestone is 60
    act(() => { jest.advanceTimersByTime(1000); });

    expect(screen.getByText(/Next: Strong \(60%\)/)).toBeInTheDocument();
    expect(screen.getByText(/10% away/)).toBeInTheDocument();
  });
});
