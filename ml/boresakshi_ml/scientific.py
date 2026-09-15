from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .evaluation import EvaluationConfig, evaluate_phase4_run
from .metrics import spatial_block_bootstrap_intervals


@dataclass(frozen=True)
class ScientificEvaluationConfig:
    output_dir: Path
    evaluation_id: str
    folds: int = 5
    inner_folds: int = 3
    interval_coverage: float = 0.90
    min_rows: int = 30
    min_spatial_blocks: int = 5
    calibration_bins: int = 10
    seed: int = 42
    bootstrap_iterations: int = 500
    confidence_level: float = 0.95


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _render_markdown(report: dict[str, Any]) -> str:
    lines = [
        f"# BoreSakshi Phase 5 Scientific Evaluation — {report['evaluationId']}",
        "",
        f"Dataset: `{report['trainingDataset']['datasetVersion']}` / `{report['trainingDataset']['datasetHash']}`",
        "",
        "All reported performance comes from spatially held-out out-of-fold predictions. Confidence intervals use spatial-block bootstrap resampling.",
        "",
    ]
    for task, details in report["tasks"].items():
        lines.extend([f"## {task.title()}", ""])
        if details["status"] != "evaluated":
            lines.extend(["Blocked: " + "; ".join(details.get("readinessErrors") or []), ""])
            continue
        selection = details["selection"]
        selected = next(candidate for candidate in details["candidates"] if candidate["candidate"] == selection["selectedCandidate"])
        metrics = selected["calibratedMetrics"] if task == "success" else selected["metrics"]
        lines.extend([
            f"Selected candidate: **{selection['selectedCandidate']}**",
            "",
            f"Selection rule: {selection['selectionRationale']}",
            "",
            "Measured spatial-OOF metrics:",
            "",
            "```json",
            json.dumps(metrics, indent=2, sort_keys=True),
            "```",
            "",
            "Spatial-block bootstrap confidence intervals:",
            "",
            "```json",
            json.dumps(selected["metricConfidenceIntervals"], indent=2, sort_keys=True),
            "```",
            "",
        ])
        if task == "success":
            lines.extend([
                "Calibration:",
                "",
                "```json",
                json.dumps(selected["calibratedCalibration"], indent=2, sort_keys=True),
                "```",
                "",
            ])
        else:
            lines.extend([
                "Prediction interval evaluation:",
                "",
                "```json",
                json.dumps(selected["intervals"], indent=2, sort_keys=True),
                "```",
                "",
            ])
    lines.extend([
        "## Promotion gate",
        "",
        "The selected candidates are scientifically selected but `servingApproved=false`. Human review and Phase 6 service integration are still required.",
        "",
    ])
    return "\n".join(lines)


def evaluate_scientifically(
    dataset: dict[str, Any],
    phase4_run_dir: str | Path,
    config: ScientificEvaluationConfig,
) -> dict[str, Any]:
    if config.bootstrap_iterations < 20:
        raise ValueError("bootstrap_iterations must be at least 20")
    if not 0.5 < config.confidence_level < 1.0:
        raise ValueError("confidence_level must be between 0.5 and 1")

    report = evaluate_phase4_run(
        dataset,
        phase4_run_dir,
        EvaluationConfig(
            output_dir=config.output_dir,
            evaluation_id=config.evaluation_id,
            folds=config.folds,
            inner_folds=config.inner_folds,
            interval_coverage=config.interval_coverage,
            min_rows=config.min_rows,
            min_spatial_blocks=config.min_spatial_blocks,
            calibration_bins=config.calibration_bins,
            seed=config.seed,
        ),
    )

    report["methodology"]["metricConfidenceIntervals"] = "spatial-block bootstrap over spatial-OOF predictions"
    report["config"]["bootstrapIterations"] = config.bootstrap_iterations
    report["config"]["confidenceLevel"] = config.confidence_level

    for task, details in report["tasks"].items():
        if details["status"] != "evaluated":
            continue
        for candidate in details["candidates"]:
            records = candidate["oofPredictions"]
            actual = np.asarray([record["actual"] for record in records])
            prediction = np.asarray([record["prediction"] for record in records], dtype=float)
            groups = np.asarray([record["spatialBlockId"] for record in records], dtype=object)
            candidate["metricConfidenceIntervals"] = spatial_block_bootstrap_intervals(
                actual,
                prediction,
                groups,
                task=task,
                iterations=config.bootstrap_iterations,
                confidence_level=config.confidence_level,
                seed=config.seed,
            )

        selection = details.get("selection")
        if selection:
            selected = next(candidate for candidate in details["candidates"] if candidate["candidate"] == selection["selectedCandidate"])
            selection["metricConfidenceIntervals"] = selected["metricConfidenceIntervals"]

    root = config.output_dir / config.evaluation_id
    manifest_path = root / "evaluation-manifest.json"
    report_path = root / "evaluation-report.md"
    checksum_path = root / "evaluation-manifest.sha256"
    manifest_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    report_path.write_text(_render_markdown(report), encoding="utf-8")
    manifest_sha = _sha256_file(manifest_path)
    checksum_path.write_text(f"{manifest_sha}  {manifest_path.name}\n", encoding="utf-8")
    report["artifacts"] = {
        "manifest": {"path": manifest_path.name, "sha256": manifest_sha, "byteSize": manifest_path.stat().st_size},
        "humanReport": {"path": report_path.name, "sha256": _sha256_file(report_path), "byteSize": report_path.stat().st_size},
        "manifestChecksum": {"path": checksum_path.name},
    }
    return report
