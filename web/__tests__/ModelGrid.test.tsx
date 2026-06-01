import React from "react";
import { render, screen } from "@testing-library/react";
import ModelGrid from "../app/components/ModelGrid";

describe("ModelGrid Component", () => {
  const sampleModels = [
    { model: "us.amazon.nova-pro-v1:0", visibility_pct: 75 },
    { model: "meta.llama3-3-70b-instruct-v1:0", visibility_pct: 20 },
  ];

  it("renders all models in grid", () => {
    render(<ModelGrid models={sampleModels} />);

    // Model titles
    expect(screen.getByText("Nova Pro")).toBeInTheDocument();
    expect(screen.getByText("Llama 3.3 70B")).toBeInTheDocument();

    // Scores
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();

    // Provider Badges
    expect(screen.getByText("Amazon")).toBeInTheDocument();
    expect(screen.getByText("Meta")).toBeInTheDocument();
  });
});
