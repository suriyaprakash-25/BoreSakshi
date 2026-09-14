from __future__ import annotations

import math
from typing import Any

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)


def _finite_float(value: float | np.floating | None) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    return numeric if math.isfinite(numeric) else None


def classification_metrics(y_true: np.ndarray, probabilities: np.ndarray, threshold: float = 0.5) -> dict[str, float | None]:
    y = np.asarray(y_true, dtype=int)
    p = np.clip(np.asarray(probabilities, dtype=float), 0.0, 1.0)
    predicted = (p >= threshold).astype(int)
    roc_auc = None
    if len(np.unique(y)) == 2:
        roc_auc = _finite_float(roc_auc_score(y, p))
    return {
        "accuracy": _finite_float(accuracy_score(y, predicted)),
        "precision": _finite_float(precision_score(y, predicted, zero_division=0)),
        "recall": _finite_float(recall_score(y, predicted, zero_division=0)),
        "f1": _finite_float(f1_score(y, predicted, zero_division=0)),
        "rocAuc": roc_auc,
        "brier": _finite_float(brier_score_loss(y, p)),
    }


def calibration_report(y_true: np.ndarray, probabilities: np.ndarray, bins: int = 10) -> dict[str, Any]:
    if bins < 2:
        raise ValueError("bins must be at least 2")
    y = np.asarray(y_true, dtype=int)
    p = np.clip(np.asarray(probabilities, dtype=float), 0.0, 1.0)
    edges = np.linspace(0.0, 1.0, bins + 1)
    rows: list[dict[str, Any]] = []
    weighted_error = 0.0
    for index in range(bins):
        low, high = edges[index], edges[index + 1]
        mask = (p >= low) & (p < high if index < bins - 1 else p <= high)
        count = int(mask.sum())
        if not count:
            rows.append({
                "bin": index + 1,
                "lower": float(low),
                "upper": float(high),
                "count": 0,
                "meanProbability": None,
                "observedRate": None,
                "absoluteGap": None,
            })
            continue
        mean_probability = float(np.mean(p[mask]))
        observed_rate = float(np.mean(y[mask]))
        gap = abs(mean_probability - observed_rate)
        weighted_error += (count / len(y)) * gap
        rows.append({
            "bin": index + 1,
            "lower": float(low),
            "upper": float(high),
            "count": count,
            "meanProbability": mean_probability,
            "observedRate": observed_rate,
            "absoluteGap": gap,
        })
    return {
        "expectedCalibrationError": float(weighted_error),
        "bins": rows,
    }


def classification_uncertainty(probabilities: np.ndarray, y_true: np.ndarray | None = None) -> dict[str, Any]:
    p = np.clip(np.asarray(probabilities, dtype=float), 1e-12, 1 - 1e-12)
    entropy = -(p * np.log(p) + (1 - p) * np.log(1 - p)) / np.log(2)
    max_probability = np.maximum(p, 1 - p)
    report: dict[str, Any] = {
        "meanNormalizedEntropy": float(np.mean(entropy)),
        "medianNormalizedEntropy": float(np.median(entropy)),
        "meanMaxClassProbability": float(np.mean(max_probability)),
        "coverageByConfidence": [],
    }
    if y_true is not None:
        y = np.asarray(y_true, dtype=int)
        predicted = (p >= 0.5).astype(int)
        for threshold in (0.55, 0.65, 0.75, 0.85):
            mask = max_probability >= threshold
            covered = int(mask.sum())
            report["coverageByConfidence"].append({
                "minimumClassProbability": threshold,
                "coveredRows": covered,
                "coveragePct": float(100 * covered / len(y)) if len(y) else 0.0,
                "accuracyOnCoveredRows": float(accuracy_score(y[mask], predicted[mask])) if covered else None,
            })
    return report


def regression_metrics(y_true: np.ndarray, predictions: np.ndarray) -> dict[str, float | None]:
    y = np.asarray(y_true, dtype=float)
    p = np.asarray(predictions, dtype=float)
    mse = mean_squared_error(y, p)
    return {
        "mae": _finite_float(mean_absolute_error(y, p)),
        "rmse": _finite_float(math.sqrt(float(mse))),
        "r2": _finite_float(r2_score(y, p)) if len(y) >= 2 else None,
        "negativePredictionPct": float(100 * np.mean(p < 0)) if len(p) else 0.0,
    }


def spatial_block_bootstrap_intervals(
    y_true: np.ndarray,
    predictions: np.ndarray,
    groups: np.ndarray,
    task: str,
    iterations: int = 500,
    confidence_level: float = 0.95,
    seed: int = 42,
) -> dict[str, Any]:
    if iterations < 20:
        raise ValueError("bootstrap iterations must be at least 20")
    if not 0.5 < confidence_level < 1.0:
        raise ValueError("confidence_level must be between 0.5 and 1")
    y = np.asarray(y_true)
    p = np.asarray(predictions, dtype=float)
    g = np.asarray(groups, dtype=object)
    unique_groups = np.unique(g)
    if len(unique_groups) < 2:
        raise ValueError("at least two spatial groups are required for block bootstrap")

    metric_names = ["accuracy", "precision", "recall", "f1", "rocAuc", "brier"] if task == "success" else ["mae", "rmse", "r2"]
    samples: dict[str, list[float]] = {name: [] for name in metric_names}
    rng = np.random.default_rng(seed)
    group_indices = {group: np.flatnonzero(g == group) for group in unique_groups}

    for _ in range(iterations):
        chosen = rng.choice(unique_groups, size=len(unique_groups), replace=True)
        indices = np.concatenate([group_indices[group] for group in chosen])
        if task == "success":
            metrics = classification_metrics(y[indices].astype(int), p[indices])
        else:
            metrics = regression_metrics(y[indices].astype(float), p[indices])
        for name in metric_names:
            value = metrics.get(name)
            if value is not None and math.isfinite(float(value)):
                samples[name].append(float(value))

    alpha = (1.0 - confidence_level) / 2.0
    intervals: dict[str, Any] = {}
    for name, values in samples.items():
        if not values:
            intervals[name] = {"lower": None, "upper": None, "bootstrapSamples": 0}
            continue
        intervals[name] = {
            "lower": float(np.quantile(values, alpha)),
            "upper": float(np.quantile(values, 1.0 - alpha)),
            "bootstrapSamples": len(values),
        }
    return {
        "method": "spatial_block_bootstrap",
        "confidenceLevel": confidence_level,
        "requestedIterations": iterations,
        "spatialBlockCount": len(unique_groups),
        "metrics": intervals,
    }


def conformal_quantile(residuals: np.ndarray, coverage: float = 0.90) -> float:
    if not 0.5 < coverage < 1.0:
        raise ValueError("coverage must be between 0.5 and 1")
    values = np.asarray(residuals, dtype=float)
    values = values[np.isfinite(values)]
    if not len(values):
        raise ValueError("at least one finite residual is required")
    quantile = min(1.0, math.ceil((len(values) + 1) * coverage) / len(values))
    return float(np.quantile(values, quantile, method="higher"))


def interval_report(
    y_true: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    target_coverage: float,
) -> dict[str, Any]:
    y = np.asarray(y_true, dtype=float)
    lo = np.asarray(lower, dtype=float)
    hi = np.asarray(upper, dtype=float)
    valid = np.isfinite(y) & np.isfinite(lo) & np.isfinite(hi)
    if not valid.any():
        return {
            "targetCoverage": target_coverage,
            "evaluatedRows": 0,
            "empiricalCoveragePct": None,
            "meanWidth": None,
            "medianWidth": None,
        }
    covered = (y[valid] >= lo[valid]) & (y[valid] <= hi[valid])
    widths = hi[valid] - lo[valid]
    return {
        "targetCoverage": target_coverage,
        "evaluatedRows": int(valid.sum()),
        "empiricalCoveragePct": float(100 * np.mean(covered)),
        "meanWidth": float(np.mean(widths)),
        "medianWidth": float(np.median(widths)),
    }
