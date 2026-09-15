from __future__ import annotations

import copy

import numpy as np
import pytest

from boresakshi_ml.data import DatasetContractError, rows_for_task, validate_feature_dataset
from boresakshi_ml.metrics import classification_metrics, regression_metrics
from boresakshi_ml.phase7 import PREDICTION_CONTRACT_VERSION, PredictionContractError, validate_ml_prediction_contract
from boresakshi_ml.schema import ALL_FEATURES, CATEGORICAL_FEATURES, FEATURE_SCHEMA_VERSION, NUMERIC_FEATURES, TASKS


def release_dataset() -> dict:
    features = {name: float(index + 1) for index, name in enumerate(NUMERIC_FEATURES)}
    features.update({
        "hydrologyWatershedId": "W-1",
        "geologyFormation": "Granite",
        "geologyLithology": "Fractured",
        "satelliteLandUseClass": "Cropland",
    })
    return {
        "datasetVersion": "phase17-regression-v1",
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "datasetHash": "d" * 64,
        "manifestSha256": "e" * 64,
        "rows": [{
            "targetId": "well-release-1",
            "spatialBlockId": "block-1",
            "lat": 11.383,
            "lng": 77.895,
            "features": features,
            "labels": {"success": True, "depthFt": 420, "waterStrikeFt": 280, "yieldLpm": 45.0},
        }],
    }


def valid_prediction() -> dict:
    timestamp = "2026-09-15T03:00:00Z"
    feature_version = "phase17:features-1.0.0"
    snapshot_ref = "fsnap:" + "a" * 64
    return {
        "successProbability": 72.5,
        "estimatedDepthFt": {"min": 250.0, "estimate": 300.0, "max": 350.0},
        "estimatedYieldLpm": {"min": 20.0, "estimate": 30.0, "max": 40.0},
        "confidence": "High",
        "modelVersion": "phase4@phase5",
        "featureVersion": feature_version,
        "predictionTimestamp": timestamp,
        "predictionContractVersion": PREDICTION_CONTRACT_VERSION,
        "featureSnapshotRef": snapshot_ref,
        "featureSnapshot": {
            "ref": snapshot_ref,
            "datasetVersion": "phase17-regression-v1",
            "featureVersion": feature_version,
            "featureManifestSha256": "b" * 64,
            "predictionAsOf": timestamp,
        },
        "explanations": [],
        "uncertainty": {"method": "calibrated+conformal"},
        "featureCoverage": {"coveragePct": 96.0},
        "coverageWarning": None,
        "predictionSource": "ml",
        "isMock": False,
    }


def test_release_feature_contract_is_exact_and_never_uses_raw_location_or_labels():
    assert len(ALL_FEATURES) == 26
    assert len(NUMERIC_FEATURES) == 22
    assert len(CATEGORICAL_FEATURES) == 4
    assert not {"lat", "lng", "success", "depthFt", "waterStrikeFt", "yieldLpm", "labels"}.intersection(ALL_FEATURES)
    assert TASKS["depth"]["label"] == "waterStrikeFt"


def test_release_dataset_validation_and_task_projection_keep_labels_out_of_features():
    dataset = release_dataset()
    validate_feature_dataset(dataset)
    X, y, rows = rows_for_task(dataset, "depth")
    assert list(X.columns) == list(ALL_FEATURES)
    assert "lat" not in X.columns and "lng" not in X.columns
    assert float(y[0]) == 280.0
    assert rows[0]["labels"]["depthFt"] == 420

    leaked = copy.deepcopy(dataset)
    leaked["rows"][0]["features"]["success"] = True
    with pytest.raises(DatasetContractError, match="leakage"):
        validate_feature_dataset(leaked)

    drifted = copy.deepcopy(dataset)
    drifted["rows"][0]["features"].pop(ALL_FEATURES[0])
    with pytest.raises(DatasetContractError, match="missing schema fields"):
        validate_feature_dataset(drifted)


def test_release_metric_regression_guard_keeps_classification_and_regression_metrics_finite():
    cls = classification_metrics(np.asarray([0, 0, 1, 1]), np.asarray([0.1, 0.3, 0.7, 0.9]))
    assert 0 <= cls["brier"] <= 1
    assert cls["accuracy"] == 1.0
    assert cls["rocAuc"] == 1.0

    reg = regression_metrics(np.asarray([100.0, 200.0, 300.0]), np.asarray([110.0, 190.0, 300.0]))
    assert reg["mae"] == pytest.approx(20 / 3)
    assert reg["rmse"] > 0
    assert np.isfinite(reg["r2"])


def test_release_inference_contract_rejects_fallback_or_mock_output_masquerading_as_ml():
    prediction = valid_prediction()
    assert validate_ml_prediction_contract(prediction) is prediction

    fallback = copy.deepcopy(prediction)
    fallback["predictionSource"] = "heuristic_fallback"
    fallback["isMock"] = True
    with pytest.raises(PredictionContractError, match="predictionSource=ml"):
        validate_ml_prediction_contract(fallback)


def test_release_inference_contract_rejects_tampered_feature_snapshot_and_impossible_ranges():
    tampered = valid_prediction()
    tampered["featureSnapshot"]["predictionAsOf"] = "2026-09-14T03:00:00Z"
    with pytest.raises(PredictionContractError, match="timestamp mismatch"):
        validate_ml_prediction_contract(tampered)

    impossible = valid_prediction()
    impossible["estimatedDepthFt"] = {"min": 400.0, "estimate": 300.0, "max": 350.0}
    with pytest.raises(PredictionContractError, match="min <= estimate <= max"):
        validate_ml_prediction_contract(impossible)
