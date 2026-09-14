from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from boresakshi_ml.evaluation import EvaluationConfig, evaluate_phase4_run
from boresakshi_ml.live_features import FeatureExtractor, FeatureManifestError
from boresakshi_ml.schema import CATEGORICAL_FEATURES, NUMERIC_FEATURES
from boresakshi_ml.serving import ServingBundle, ServingBundleError
from boresakshi_ml.training import TrainingConfig, train_model_candidates
from service import BundleManager, create_app


def synthetic_dataset(rows: int = 48, blocks: int = 8):
    built = []
    for i in range(rows):
        block = i % blocks
        features = {name: float(((i + 3) * (j + 5) + block) % 31) for j, name in enumerate(NUMERIC_FEATURES)}
        features.update({
            "hydrologyWatershedId": f"W-{block % 4}",
            "geologyFormation": ["Granite", "Gneiss", "Charnockite"][block % 3],
            "geologyLithology": ["Fractured", "Massive"][i % 2],
            "satelliteLandUseClass": ["Cropland", "Scrub", "Built-up"][block % 3],
        })
        success = ((i + block * 2) % 7) >= 3
        built.append({
            "targetId": f"well-{i}",
            "lat": 10.7 + block * 0.15,
            "lng": 76.8 + block * 0.12,
            "asOf": f"2025-{(i % 12) + 1:02d}-{(i % 27) + 1:02d}T00:00:00.000Z",
            "spatialBlockId": f"block-{block}",
            "features": features,
            "labels": {
                "success": success,
                "depthFt": 320 + i,
                "waterStrikeFt": 160 + block * 12 + (i % 5) * 3,
                "yieldLpm": 20 + ((i + block) % 9) * 6,
            },
            "coverage": {"coveragePct": 100.0},
        })
    return {
        "datasetVersion": "synthetic-phase6-v1",
        "featureSchemaVersion": "1.0.0",
        "datasetHash": "6" * 64,
        "manifestSha256": "7" * 64,
        "rows": built,
    }


def write_feature_manifest(root: Path, dataset_version: str) -> Path:
    grid = """ncols 5
nrows 5
xllcorner 76.98
yllcorner 10.98
cellsize 0.01
NODATA_value -9999
120 122 124 126 128
116 118 120 122 124
112 114 116 118 120
108 110 112 114 116
104 106 108 110 112
"""
    grid_path = root / "dem.asc"
    grid_path.write_text(grid, encoding="utf-8")
    sha = hashlib.sha256(grid.encode("utf-8")).hexdigest()
    manifest = {
        "datasetVersion": dataset_version,
        "parameters": {"nearbyRadiusKm": 5, "densityRadiusKm": 2},
        "layers": [{
            "id": "dem-test",
            "kind": "dem",
            "format": "esri_ascii",
            "path": "dem.asc",
            "sourceName": "test",
            "sourceReference": "unit-test",
            "license": "test-only",
            "sha256": sha,
            "static": True,
        }],
    }
    path = root / "feature-manifest.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return path


@pytest.fixture(scope="module")
def serving_fixture(tmp_path_factory):
    root = tmp_path_factory.mktemp("phase6")
    dataset = synthetic_dataset()
    phase4_root = root / "artifacts"
    train_model_candidates(dataset, TrainingConfig(
        output_dir=phase4_root,
        run_id="phase4-service-test",
        seed=9,
        min_rows=20,
        profile="test",
        algorithms=("logistic_regression", "ridge_regression"),
    ))
    phase4_run = phase4_root / "phase4-service-test"
    phase5_root = root / "evaluations"
    evaluate_phase4_run(dataset, phase4_run, EvaluationConfig(
        output_dir=phase5_root,
        evaluation_id="phase5-service-test",
        folds=4,
        inner_folds=2,
        min_rows=20,
        min_spatial_blocks=4,
        seed=13,
    ))
    manifest = write_feature_manifest(root, dataset["datasetVersion"])
    return root, dataset, phase4_run, phase5_root / "phase5-service-test", manifest


def verified_nearby():
    return [
        {
            "id": "verified-1",
            "lat": 11.006,
            "lng": 77.006,
            "success": True,
            "depthFt": 230,
            "yieldLpm": 48,
            "drilledAt": "2025-01-01T00:00:00Z",
            "verified": True,
            "flagged": False,
            "datasetEligibility": {"eligible": True},
        },
        {
            "id": "unverified",
            "lat": 11.006,
            "lng": 77.006,
            "success": False,
            "depthFt": 900,
            "yieldLpm": 0,
            "drilledAt": "2025-01-02T00:00:00Z",
            "verified": False,
        },
    ]


def test_live_feature_extractor_uses_only_verified_history(serving_fixture):
    _, dataset, _, _, manifest = serving_fixture
    extractor = FeatureExtractor(manifest)
    result = extractor.extract(11.005, 77.005, verified_nearby())
    assert result["featureVersion"].startswith(dataset["datasetVersion"])
    assert result["features"]["nearbyCount"] == 1
    assert result["features"]["nearbySuccessRate"] == 1.0
    assert result["coverage"]["coveragePct"] > 30


def test_feature_source_checksum_is_enforced(serving_fixture):
    root, _, _, _, manifest = serving_fixture
    bad_manifest = root / "bad-feature-manifest.json"
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    payload["layers"][0]["sha256"] = "0" * 64
    bad_manifest.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(FeatureManifestError, match="checksum"):
        FeatureExtractor(bad_manifest)


def test_serving_bundle_requires_explicit_approval_and_predicts(serving_fixture):
    _, _, phase4_run, phase5_eval, manifest = serving_fixture
    with pytest.raises(ServingBundleError, match="approval"):
        ServingBundle(
            phase4_run_dir=phase4_run,
            phase5_evaluation_dir=phase5_eval,
            feature_manifest_path=manifest,
            approved=False,
        )
    bundle = ServingBundle(
        phase4_run_dir=phase4_run,
        phase5_evaluation_dir=phase5_eval,
        feature_manifest_path=manifest,
        approved=True,
        min_feature_coverage_pct=30,
    )
    result = bundle.predict(lat=11.005, lng=77.005, nearby_borewells=verified_nearby())
    assert 0 <= result["successProbability"] <= 100
    assert result["estimatedDepthFt"]["min"] <= result["estimatedDepthFt"]["max"]
    assert result["estimatedYieldLpm"]["min"] <= result["estimatedYieldLpm"]["max"]
    assert result["predictionSource"] == "ml"
    assert result["isMock"] is False
    assert result["modelVersion"]
    assert result["featureVersion"]
    assert "normalizedEntropy" in result["uncertainty"]["success"]
    assert isinstance(result["explanations"], list)


def test_fastapi_health_model_info_and_predict(serving_fixture):
    _, _, phase4_run, phase5_eval, manifest = serving_fixture
    bundle = ServingBundle(
        phase4_run_dir=phase4_run,
        phase5_evaluation_dir=phase5_eval,
        feature_manifest_path=manifest,
        approved=True,
        min_feature_coverage_pct=30,
    )
    app = create_app(BundleManager(bundle=bundle))
    with TestClient(app) as client:
        health = client.get("/ml/health")
        assert health.status_code == 200
        assert health.json()["ready"] is True
        info = client.get("/ml/model-info")
        assert info.status_code == 200
        assert set(info.json()["selectedModels"]) == {"success", "depth", "yield"}
        prediction = client.post("/ml/predict", json={
            "lat": 11.005,
            "lng": 77.005,
            "nearbyBorewells": verified_nearby(),
        })
        assert prediction.status_code == 200
        body = prediction.json()
        assert body["predictionSource"] == "ml"
        assert body["estimatedDepthFt"]["min"] >= 0
