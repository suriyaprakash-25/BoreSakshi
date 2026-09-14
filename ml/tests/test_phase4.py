from __future__ import annotations

from pathlib import Path

import pytest

from boresakshi_ml.data import DatasetContractError, rows_for_task, validate_feature_dataset
from boresakshi_ml.inference import load_candidate, predict_candidate
from boresakshi_ml.models import candidate_specs
from boresakshi_ml.schema import ALL_FEATURES, CATEGORICAL_FEATURES, NUMERIC_FEATURES, TASKS
from boresakshi_ml.training import TrainingConfig, train_model_candidates


def synthetic_dataset(rows: int = 36):
    built = []
    for i in range(rows):
        features = {name: float((i + j) % 13) for j, name in enumerate(NUMERIC_FEATURES)}
        features.update({
            "hydrologyWatershedId": f"W-{i % 4}",
            "geologyFormation": ["Granite", "Gneiss", "Charnockite"][i % 3],
            "geologyLithology": ["Fractured", "Massive"][i % 2],
            "satelliteLandUseClass": ["Cropland", "Scrub", "Built-up"][i % 3],
        })
        built.append({
            "targetId": f"well-{i}",
            "spatialBlockId": f"block-{i % 6}",
            "features": features,
            "labels": {
                "success": bool(i % 2),
                "depthFt": 400 + i * 3,
                "waterStrikeFt": 180 + i * 2,
                "yieldLpm": float((i % 8) * 12),
            },
        })
    return {
        "datasetVersion": "synthetic-v1",
        "featureSchemaVersion": "1.0.0",
        "datasetHash": "d" * 64,
        "manifestSha256": "m" * 64,
        "rows": built,
    }


def test_feature_contract_has_26_phase3_features():
    assert len(ALL_FEATURES) == 26
    assert len(NUMERIC_FEATURES) == 22
    assert len(CATEGORICAL_FEATURES) == 4


def test_depth_target_is_water_strike_not_total_depth():
    dataset = synthetic_dataset(8)
    _, y, _ = rows_for_task(dataset, "depth")
    assert y[0] == 180
    assert y[0] != dataset["rows"][0]["labels"]["depthFt"]
    assert TASKS["depth"]["label"] == "waterStrikeFt"


def test_dataset_contract_rejects_label_leakage():
    dataset = synthetic_dataset(8)
    dataset["rows"][0]["features"]["success"] = True
    with pytest.raises(DatasetContractError, match="leakage"):
        validate_feature_dataset(dataset)


def test_candidate_registry_covers_roadmap_algorithms():
    success = {spec.name for spec in candidate_specs("success", profile="test")}
    regression = {spec.name for spec in candidate_specs("depth", profile="test")}
    assert {"logistic_regression", "random_forest", "xgboost", "lightgbm"}.issubset(success)
    assert {"random_forest", "xgboost", "lightgbm"}.issubset(regression)
    assert "ridge_regression" in regression


def test_training_registers_three_tasks_without_publishing_metrics(tmp_path: Path):
    dataset = synthetic_dataset(36)
    config = TrainingConfig(
        output_dir=tmp_path,
        run_id="test-run",
        seed=7,
        min_rows=8,
        profile="test",
        algorithms=("logistic_regression", "ridge_regression", "random_forest"),
    )
    manifest = train_model_candidates(dataset, config)
    assert set(manifest["tasks"]) == {"success", "depth", "yield"}
    assert manifest["phaseBoundary"]["performanceMetricsPublished"] is False
    assert manifest["phaseBoundary"]["candidateSelected"] is False
    assert manifest["phaseBoundary"]["liveApiIntegration"] is False
    for task in ("success", "depth", "yield"):
        assert manifest["tasks"][task]["status"] == "trained_candidates"
        assert all(candidate["evaluationStatus"] == "not_evaluated_phase5" for candidate in manifest["tasks"][task]["candidates"])
        assert not any("metrics" in candidate for candidate in manifest["tasks"][task]["candidates"])
    assert (tmp_path / "test-run" / "run-manifest.json").exists()
    assert (tmp_path / "test-run" / "run-manifest.sha256").exists()


def test_serialized_candidate_can_predict_offline(tmp_path: Path):
    dataset = synthetic_dataset(36)
    manifest = train_model_candidates(dataset, TrainingConfig(
        output_dir=tmp_path,
        run_id="predict-run",
        min_rows=8,
        profile="test",
        algorithms=("logistic_regression", "ridge_regression"),
    ))
    success_candidate = next(c for c in manifest["tasks"]["success"]["candidates"] if c["status"] == "trained")
    success_model = load_candidate(tmp_path / success_candidate["artifact"]["path"])
    result = predict_candidate(success_model, "success", dataset["rows"][0]["features"])
    assert 0.0 <= result["successProbability"] <= 1.0

    depth_candidate = next(c for c in manifest["tasks"]["depth"]["candidates"] if c["status"] == "trained")
    depth_model = load_candidate(tmp_path / depth_candidate["artifact"]["path"])
    depth = predict_candidate(depth_model, "depth", dataset["rows"][0]["features"])
    assert isinstance(depth["estimatedWaterStrikeFt"], float)


def test_insufficient_rows_block_artifact_training(tmp_path: Path):
    dataset = synthetic_dataset(4)
    manifest = train_model_candidates(dataset, TrainingConfig(
        output_dir=tmp_path,
        run_id="blocked",
        min_rows=10,
        profile="test",
        algorithms=("logistic_regression", "ridge_regression"),
    ))
    assert all(details["status"] == "blocked" for details in manifest["tasks"].values())
    assert all(details["readinessErrors"] for details in manifest["tasks"].values())
