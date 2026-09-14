from __future__ import annotations

import hashlib
import json

import pytest
from fastapi.testclient import TestClient

from boresakshi_ml.phase7 import (
    PREDICTION_CONTRACT_VERSION,
    PredictionContractError,
    attach_prediction_metadata,
    build_activation_report,
    feature_snapshot_metadata,
    validate_ml_prediction_contract,
    write_checksummed_report,
)
from boresakshi_ml.serving import ServingBundle
from service import BundleManager, create_app
from test_phase6 import serving_fixture, verified_nearby


def _bundle(serving_fixture):
    _, _, phase4_run, phase5_eval, manifest = serving_fixture
    return ServingBundle(
        phase4_run_dir=phase4_run,
        phase5_evaluation_dir=phase5_eval,
        feature_manifest_path=manifest,
        approved=True,
        min_feature_coverage_pct=30,
    )


def test_feature_snapshot_reference_is_deterministic_and_time_versioned(serving_fixture):
    bundle = _bundle(serving_fixture)
    one = feature_snapshot_metadata(bundle, "2026-09-15T00:00:00Z")
    two = feature_snapshot_metadata(bundle, "2026-09-15T00:00:00Z")
    later = feature_snapshot_metadata(bundle, "2026-09-16T00:00:00Z")
    assert one == two
    assert one["ref"].startswith("fsnap:")
    assert len(one["ref"].split(":", 1)[1]) == 64
    assert one["ref"] != later["ref"]
    assert one["featureManifestSha256"] == bundle.feature_extractor.manifest_sha256


def test_service_returns_complete_phase7_contract(serving_fixture):
    bundle = _bundle(serving_fixture)
    app = create_app(BundleManager(bundle=bundle))
    with TestClient(app) as client:
        response = client.post("/ml/predict", json={
            "lat": 11.005,
            "lng": 77.005,
            "predictionTimestamp": "2026-09-15T00:00:00Z",
            "nearbyBorewells": verified_nearby(),
        })
        assert response.status_code == 200
        body = response.json()
        validate_ml_prediction_contract(body)
        assert body["predictionContractVersion"] == PREDICTION_CONTRACT_VERSION
        assert body["featureSnapshotRef"] == body["featureSnapshot"]["ref"]
        assert body["featureSnapshot"]["predictionAsOf"] == body["predictionTimestamp"]


def test_prediction_contract_rejects_snapshot_tampering(serving_fixture):
    bundle = _bundle(serving_fixture)
    raw = bundle.predict(lat=11.005, lng=77.005, nearby_borewells=verified_nearby())
    prediction = attach_prediction_metadata(bundle, raw)
    prediction["featureSnapshot"]["featureManifestSha256"] = "bad"
    with pytest.raises(PredictionContractError, match="manifest SHA-256"):
        validate_ml_prediction_contract(prediction)


def test_activation_report_is_checksummed_and_does_not_self_activate(serving_fixture, tmp_path):
    bundle = _bundle(serving_fixture)
    raw = bundle.predict(lat=11.005, lng=77.005, nearby_borewells=verified_nearby())
    prediction = attach_prediction_metadata(bundle, raw)
    report = build_activation_report(bundle, prediction, "phase7-test")
    report_path, checksum_path = write_checksummed_report(report, tmp_path)

    stored = json.loads(report_path.read_text(encoding="utf-8"))
    expected_sha = hashlib.sha256(report_path.read_bytes()).hexdigest()
    recorded_sha = checksum_path.read_text(encoding="utf-8").split()[0]
    assert stored["status"] == "ready_for_human_activation_review"
    assert stored["productionActivated"] is False
    assert stored["reviewGate"]["humanApprovalRequired"] is True
    assert recorded_sha == expected_sha
