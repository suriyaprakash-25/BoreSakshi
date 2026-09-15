import React from "react";

export default function PredictionSourceBanner({ data }) {
  const fallback = data?.predictionSource === "heuristic_fallback" || data?.isMock === true;
  if (fallback) {
    return React.createElement(
      "div",
      { className: "advisory", "data-testid": "prediction-source-banner" },
      React.createElement("strong", null, "Trained model unavailable."),
      " This result is the explicitly labelled heuristic fallback, not an ML prediction."
    );
  }
  if (data?.coverageWarning) {
    return React.createElement(
      "div",
      { className: "advisory", "data-testid": "prediction-source-banner" },
      React.createElement("strong", null, "Coverage warning."),
      ` ${data.coverageWarning}`
    );
  }
  return null;
}
