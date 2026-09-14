from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from boresakshi_ml.evaluation import EvaluationConfig, EvaluationContractError, evaluate_phase4_run, load_phase4_manifest
from boresakshi_ml.metrics import calibration_report, classification_metrics, conformal_quantile, interval_report, regression_metrics
from boresakshi_ml.schema import CATEGORICAL_FEATURES, NUMERIC_FEATURES
from boresakshi_ml.training import TrainingConfig, train_model_candidates


def synthetic_dataset(rows: int = 60, blocks: int = 10):
    built = []
    for i in range(rows):
        block = i % blocks
        features = {}
        for j, name in enumerate(NUMERIC_FEATURES):
            value = float(((i * (j + 3)) + block * 7) % 29)
            if i % 17 == 0 and j in (1, 8):
                value = None
            features[name] = value
        features.update({
            "hydrologyWatershedId": f"W-{block % 4}",
            "geologyFormation": ["Granite", "Gneiss", "Charnockite"][block % 3],
            "geologyLithology": ["Fractured", "Massive"][i % 2],
            "satelliteLandUseClass": ["Cropland", "Scrub", "Built-up"][block % 3],
        })
        signal = (i * 5 + block * 3) % 11
        success = signal >= 5
        built.append({
            "targetId": f"well-{i}",
            "lat": 10.8 + block * 0.12 + (i // blocks) * 0.002,
            "lng": 77.0 + block * 0.10 + (i // blocks) * 0.002,
            "asOf": f"2025-{(i % 12) + 1:02d}-{(i % 27) + 1:02d}T00:00:00.000Z",
            "spatialBlockId": f"block-{block}",
            "features": features,
            "labels": {
                "success": success,
                "depthFt": 360 + block * 8 + i,
                "waterStrikeFt": 150 + block * 11 + (i % 7) * 4,
                "yieldLpm": 15 + signal * 6 + block * 1.5,
            },
            "coverage": {"coveragePct": 96.0 if i % 17 else 90.0},
        })
    return {
        "datasetVersion": "synthetic-phase5-v1",
        "featureSchemaVersion": "1.0.0",
        "datasetHash": "e" * 64,
        "manifestSha256": "f" * 64,
        "rows": built,
    }


def phase4_run(tmp_path: Path, dataset: dict):
    out = tmp_path / "phase4-artifacts"
    manifest = train_model_candidates(dataset, TrainingConfig(
        output_dir=out,
        run_id="phase4-test",
        seed=11,
        min_rows=20,
        profile="test",
        algorithms=("logistic_regression", "ridge_regression", "random_forest"),
    ))
    assert all(task["status"] == "trained_candidates" for task in manifest["tasks"].values())
    return out / "phase4-test"


def test_metric_primitives_publish_requested_scientific_metrics():
    y = np.asarray([0, 0, 1, 1])
    p = np.asarray([0.1, 0.4, 0.7, 0.9])
    metrics = classification_metrics(y, p)
    assert {"accuracy", "precision", "recall", "f1", "rocAuc", "brier"}.issubset(metrics)
    calibration = calibration_report(y, p, bins=4)
    assert calibration["expectedCalibrationError"] >= 0

    actual = np.asarray([10.0, 20.0, 30.0])
    predicted = np.asarray([12.0, 18.0, 31.0])
    reg = regression_metrics(actual, predicted)
    assert {"mae", "rmse", "r2", "negativePredictionPct"}.issubset(reg)
    radius = conformal_quantile(np.abs(actual - predicted), 0.9)
    intervals = interval_report(actual, np.maximum(0, predicted - radius), predicted + radius, 0.9)
    assert intervals["evaluatedRows"] == 3


def test_phase4_manifest_checksum_is_enforced(tmp_path: Path):
    dataset = synthetic_dataset()
    run_dir = phase4_run(tmp_path, dataset)
    load_phase4_manifest(run_dir, dataset)
    manifest_path = run_dir / "run-manifest.json"
    manifest_path.write_text(manifest_path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    with pytest.raises(EvaluationContractError, match="checksum"):
        load_phase4_manifest(run_dir, dataset)


def test_spatial_evaluation_selects_candidates_without_serving_approval(tmp_path: Path):
    dataset = synthetic_dataset()
    run_dir = phase4_run(tmp_path, dataset)
    report = evaluate_phase4_run(dataset, run_dir, EvaluationConfig(
        output_dir=tmp_path / "phase5-evaluations",
        evaluation_id="eval-1",
        folds=5,
        inner_folds=3,
        min_rows=30,
        min_spatial_blocks=5,
        seed=17,
    ))
    assert report["blockedTasks"] == []
    assert report["servingApproved"] is False
    assert report["phaseBoundary"]["scientificEvaluationComplete"] is True
    assert report["phaseBoundary"]["liveApiIntegration"] is False

    success = report["tasks"]["success"]
    assert success["selection"]["selectedCandidate"] in {"logistic_regression", "random_forest"}
    assert success["selection"]["servingApproved"] is False
    for candidate in success["candidates"]:
        assert "brier" in candidate["calibratedMetrics"]
        assert "rocAuc" in candidate["calibratedMetrics"]
        assert "expectedCalibrationError" in candidate["calibratedCalibration"]
        assert len(candidate["oofPredictions"]) == len(dataset["rows"])
        assert {row["fold"] for row in candidate["oofPredictions"]} == {1, 2, 3, 4, 5}

    for task in ("depth", "yield"):
        details = report["tasks"][task]
        assert details["selection"]["selectedCandidate"] in {"ridge_regression", "random_forest"}
        for candidate in details["candidates"]:
            assert {"mae", "rmse", "r2"}.issubset(candidate["metrics"])
            assert candidate["intervals"]["targetCoverage"] == 0.9
            assert candidate["intervals"]["evaluatedRows"] > 0


def test_evaluation_writes_calibration_interval_and_audit_artifacts(tmp_path: Path):
    dataset = synthetic_dataset()
    run_dir = phase4_run(tmp_path, dataset)
    out = tmp_path / "phase5-evaluations"
    report = evaluate_phase4_run(dataset, run_dir, EvaluationConfig(
        output_dir=out,
        evaluation_id="eval-artifacts",
        folds=5,
        inner_folds=3,
        min_rows=30,
        min_spatial_blocks=5,
    ))
    root = out / "eval-artifacts"
    assert (root / "evaluation-manifest.json").exists()
    assert (root / "evaluation-manifest.sha256").exists()
    assert (root / "evaluation-report.md").exists()
    assert (root / "selected" / "success" / "platt-calibrator.joblib").exists()
    assert (root / "selected" / "depth" / "interval.json").exists()
    assert (root / "selected" / "yield" / "interval.json").exists()
    depth_interval = json.loads((root / "selected" / "depth" / "interval.json").read_text(encoding="utf-8"))
    assert depth_interval["radius"] >= 0
    assert depth_interval["nonNegativeLowerBound"] is True
    assert report["tasks"]["success"]["coverage"]["spatialBlockCount"] == 10
    assert report["tasks"]["success"]["coverage"]["geographicBounds"]["minLat"] is not None


def test_insufficient_spatial_coverage_blocks_selection(tmp_path: Path):
    dataset = synthetic_dataset(rows=36, blocks=3)
    run_dir = phase4_run(tmp_path, dataset)
    report = evaluate_phase4_run(dataset, run_dir, EvaluationConfig(
        output_dir=tmp_path / "phase5-evaluations",
        evaluation_id="blocked",
        folds=3,
        inner_folds=2,
        min_rows=20,
        min_spatial_blocks=5,
    ))
    assert set(report["blockedTasks"]) == {"success", "depth", "yield"}
    assert report["phaseBoundary"]["scientificEvaluationComplete"] is False
    assert all(details["selection"] is None for details in report["tasks"].values())
