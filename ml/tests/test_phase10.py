from __future__ import annotations

import json
from pathlib import Path

import pytest

from boresakshi_ml.continuous import (
    ContinuousLearningConfig,
    ContinuousLearningError,
    _write_checksummed_json,
    activate_deployment,
    approve_candidate,
    assess_monitoring_snapshot,
    compare_with_production,
    load_runtime_deployment,
    rollback_deployment,
    stage_continuous_learning_candidate,
    stage_deployment,
    validate_phase9_training_dataset,
)
from boresakshi_ml.schema import NUMERIC_FEATURES
from boresakshi_ml.scientific import ScientificEvaluationConfig, evaluate_scientifically
from boresakshi_ml.training import TrainingConfig, train_model_candidates


def synthetic_dataset(rows: int, version: str, dataset_hash: str):
    built = []
    for i in range(rows):
        block = i % 8
        features = {}
        for j, name in enumerate(NUMERIC_FEATURES):
            features[name] = float(((i * (j + 2)) + block * 5) % 31)
        features.update({
            "hydrologyWatershedId": f"W-{block % 4}",
            "geologyFormation": ["Granite", "Gneiss", "Charnockite"][block % 3],
            "geologyLithology": ["Fractured", "Massive"][i % 2],
            "satelliteLandUseClass": ["Cropland", "Scrub", "Built-up"][block % 3],
        })
        signal = (i * 7 + block * 3) % 13
        built.append({
            "targetId": f"{version}-well-{i}",
            "lat": 10.8 + block * 0.11 + (i // 8) * 0.003,
            "lng": 77.0 + block * 0.09 + (i // 8) * 0.003,
            "asOf": f"2026-{(i % 8) + 1:02d}-{(i % 27) + 1:02d}T00:00:00.000Z",
            "spatialBlockId": f"block-{block}",
            "features": features,
            "labels": {
                "success": signal >= 6,
                "depthFt": 350 + block * 10 + i,
                "waterStrikeFt": 140 + block * 12 + (i % 6) * 5,
                "yieldLpm": 18 + signal * 4 + block,
            },
            "coverage": {"coveragePct": 95.0},
        })
    return {
        "datasetVersion": version,
        "featureSchemaVersion": "1.0.0",
        "datasetHash": dataset_hash,
        "manifestSha256": "f" * 64,
        "leakagePolicy": {
            "phase2EligibilityRequired": True,
            "phase8VerifiedOperatorOutcomesRequired": True,
            "phase9VerifiedLifecycleRequired": True,
            "targetOutcomeExcludedFromFeatures": True,
            "nearbyBorewellTemporalRule": "strictly-before-target-asOf",
            "dynamicLayerTemporalRule": "latest-observation-not-after-target-asOf",
        },
        "rows": built,
    }


def make_production(tmp_path: Path, dataset: dict):
    phase4_out = tmp_path / "production-phase4"
    train_model_candidates(dataset, TrainingConfig(
        output_dir=phase4_out,
        run_id="production-run",
        seed=3,
        min_rows=20,
        profile="test",
        algorithms=("logistic_regression", "ridge_regression"),
    ))
    run_dir = phase4_out / "production-run"
    phase5_out = tmp_path / "production-phase5"
    evaluate_scientifically(dataset, run_dir, ScientificEvaluationConfig(
        output_dir=phase5_out,
        evaluation_id="production-eval",
        folds=4,
        inner_folds=2,
        min_rows=20,
        min_spatial_blocks=4,
        bootstrap_iterations=20,
        seed=5,
    ))
    return run_dir, phase5_out / "production-eval"


def test_phase10_requires_phase9_verified_dataset_gate():
    dataset = synthetic_dataset(32, "candidate-v1", "a" * 64)
    validate_phase9_training_dataset(dataset)
    dataset["leakagePolicy"]["phase9VerifiedLifecycleRequired"] = False
    with pytest.raises(ContinuousLearningError, match="phase9VerifiedLifecycleRequired"):
        validate_phase9_training_dataset(dataset)


def test_stage_candidate_trains_evaluates_compares_but_never_auto_approves(tmp_path: Path):
    production = synthetic_dataset(32, "production-v1", "1" * 64)
    production_run, production_eval = make_production(tmp_path, production)
    candidate = synthetic_dataset(36, "candidate-v2", "2" * 64)
    dataset_path = tmp_path / "candidate-dataset.json"
    dataset_path.write_text(json.dumps(candidate), encoding="utf-8")
    feature_manifest = tmp_path / "feature-manifest.json"
    feature_manifest.write_text(json.dumps({"datasetVersion": "candidate-v2", "layers": []}), encoding="utf-8")

    result = stage_continuous_learning_candidate(
        dataset_path=dataset_path,
        production_phase4_dir=production_run,
        production_phase5_dir=production_eval,
        feature_manifest_path=feature_manifest,
        config=ContinuousLearningConfig(
            output_dir=tmp_path / "continuous",
            run_id="cl-001",
            seed=7,
            min_rows=20,
            profile="test",
            algorithms=("logistic_regression", "ridge_regression"),
            folds=4,
            inner_folds=2,
            min_spatial_blocks=4,
            bootstrap_iterations=20,
        ),
    )

    assert result["phaseBoundary"]["candidateTrained"] is True
    assert result["phaseBoundary"]["scientificallyEvaluated"] is True
    assert result["phaseBoundary"]["comparedWithProduction"] is True
    assert result["phaseBoundary"]["humanApproved"] is False
    assert result["phaseBoundary"]["deployed"] is False
    assert result["automaticPromotion"] is False
    assert result["comparison"]["candidateDataset"]["rowCount"] == 36
    assert result["comparison"]["productionDataset"]["rowCount"] == 32
    assert (tmp_path / "continuous" / "cl-001" / "training-dataset-version.json.sha256").exists()
    assert (tmp_path / "continuous" / "cl-001" / "promotion-candidate.json.sha256").exists()


def test_comparison_hold_cannot_be_approved_without_explicit_override(tmp_path: Path):
    report = {
        "tasks": {
            "success": {
                "selection": {"selectedCandidate": "a"},
                "candidates": [{
                    "candidate": "a",
                    "calibratedMetrics": {"brier": 0.5, "rocAuc": 0.5},
                    "calibratedCalibration": {"expectedCalibrationError": 0.4},
                }],
            },
            "depth": {"selection": {"selectedCandidate": "b"}, "candidates": [{"candidate": "b", "metrics": {"mae": 100, "rmse": 120}}]},
            "yield": {"selection": {"selectedCandidate": "c"}, "candidates": [{"candidate": "c", "metrics": {"mae": 50, "rmse": 60}}]},
        }
    }
    production = {
        "tasks": {
            "success": {
                "selection": {"selectedCandidate": "a"},
                "candidates": [{
                    "candidate": "a",
                    "calibratedMetrics": {"brier": 0.1, "rocAuc": 0.9},
                    "calibratedCalibration": {"expectedCalibrationError": 0.05},
                }],
            },
            "depth": {"selection": {"selectedCandidate": "b"}, "candidates": [{"candidate": "b", "metrics": {"mae": 20, "rmse": 25}}]},
            "yield": {"selection": {"selectedCandidate": "c"}, "candidates": [{"candidate": "c", "metrics": {"mae": 8, "rmse": 10}}]},
        }
    }
    comparison = compare_with_production(
        report,
        production,
        candidate_row_count=50,
        production_row_count=40,
        candidate_dataset_hash="2" * 64,
        production_dataset_hash="1" * 64,
    )
    assert comparison["allGuardsPassed"] is False
    assert comparison["status"] == "HOLD_FOR_REVIEW"

    candidate_path = tmp_path / "promotion-candidate.json"
    payload = {
        "runId": "hold",
        "humanApprovalRequired": True,
        "automaticPromotion": False,
        "comparison": comparison,
        "candidate": {"modelVersion": "candidate@eval"},
    }
    _write_checksummed_json(candidate_path, payload)
    with pytest.raises(ContinuousLearningError, match="explicit override"):
        approve_candidate(
            promotion_candidate_path=candidate_path,
            reviewer="reviewer",
            reason="The scientific guards need additional investigation.",
        )
    approval = approve_candidate(
        promotion_candidate_path=candidate_path,
        reviewer="reviewer",
        reason="Independent scientific review accepts this exception for staged validation only.",
        override_comparison_hold=True,
    )
    assert approval["comparisonOverride"] is True
    assert approval["automaticDeployment"] is False


def test_approved_candidate_can_be_staged_activated_monitored_and_rolled_back(tmp_path: Path):
    feature_manifest = tmp_path / "features.json"
    feature_manifest.write_text(json.dumps({"datasetVersion": "v2"}), encoding="utf-8")

    candidate_path = tmp_path / "run" / "promotion-candidate.json"
    candidate = {
        "runId": "cl-2",
        "humanApprovalRequired": True,
        "automaticPromotion": False,
        "comparison": {"allGuardsPassed": True},
        "candidate": {
            "modelVersion": "candidate-run@candidate-eval",
            "phase4RunDir": str(tmp_path / "candidate-phase4"),
            "phase5EvaluationDir": str(tmp_path / "candidate-phase5"),
            "featureManifest": str(feature_manifest),
            "featureManifestSha256": __import__("hashlib").sha256(feature_manifest.read_bytes()).hexdigest(),
        },
    }
    _write_checksummed_json(candidate_path, candidate)
    approval = approve_candidate(
        promotion_candidate_path=candidate_path,
        reviewer="scientific-reviewer",
        reason="Candidate passed the reviewed comparison and is approved for staged deployment.",
    )
    assert approval["status"] == "HUMAN_APPROVED"

    current = tmp_path / "deployments" / "current.json"
    previous = {
        "schemaVersion": "1.0.0",
        "deploymentId": "production-old",
        "status": "ACTIVE",
        "productionActivated": True,
        "deploymentApproved": True,
        "modelVersion": "old-run@old-eval",
        "phase4RunDir": str(tmp_path / "old-phase4"),
        "phase5EvaluationDir": str(tmp_path / "old-phase5"),
        "featureManifest": str(feature_manifest),
        "featureManifestSha256": candidate["candidate"]["featureManifestSha256"],
        "previousDeployment": None,
    }
    _write_checksummed_json(current, previous)

    staged = stage_deployment(
        promotion_candidate_path=candidate_path,
        approval_path=candidate_path.parent / "approval.json",
        deployment_id="deployment-new",
        current_pointer_path=current,
    )
    assert staged["status"] == "STAGED"
    assert staged["productionActivated"] is False
    assert staged["rollbackTarget"]["modelVersion"] == "old-run@old-eval"

    activated = activate_deployment(
        staged_deployment_path=candidate_path.parent / "deployment-staged.json",
        current_pointer_path=current,
        actor="release-manager",
        reason="Reviewed candidate is entering controlled production serving.",
        confirm="DEPLOY",
    )
    assert activated["status"] == "ACTIVE"
    assert activated["productionActivated"] is True
    runtime = load_runtime_deployment(current)
    assert runtime["modelVersion"] == "candidate-run@candidate-eval"

    monitor = assess_monitoring_snapshot(
        current_pointer_path=current,
        metrics={"scored": 30, "brier": 0.45, "depthMaeFt": 75, "yieldMaeLpm": 25},
        min_scored=20,
        max_brier=0.30,
    )
    assert monitor["status"] == "ROLLBACK_REVIEW_RECOMMENDED"
    assert monitor["automaticRollback"] is False

    restored = rollback_deployment(
        current_pointer_path=current,
        actor="release-manager",
        reason="Observed post-deployment calibration exceeded the reviewed guardrail.",
        confirm="ROLLBACK",
    )
    assert restored["modelVersion"] == "old-run@old-eval"
    assert restored["rollback"]["fromModelVersion"] == "candidate-run@candidate-eval"
