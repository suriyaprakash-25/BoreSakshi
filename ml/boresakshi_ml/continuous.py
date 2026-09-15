from __future__ import annotations

import hashlib
import json
import os
import shutil
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .data import load_feature_dataset
from .scientific import ScientificEvaluationConfig, evaluate_scientifically
from .training import TrainingConfig, train_model_candidates


CONTINUOUS_LEARNING_SCHEMA_VERSION = "1.0.0"
DEPLOYMENT_SCHEMA_VERSION = "1.0.0"


class ContinuousLearningError(RuntimeError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_checksummed_json(path: Path, payload: dict[str, Any], *, refuse_overwrite: bool = False) -> tuple[Path, Path]:
    if refuse_overwrite and path.exists():
        raise ContinuousLearningError(f"immutable artifact already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
    checksum = _sha256_file(path)
    sidecar = path.with_suffix(path.suffix + ".sha256")
    sidecar_tmp = sidecar.with_suffix(sidecar.suffix + ".tmp")
    sidecar_tmp.write_text(f"{checksum}  {path.name}\n", encoding="utf-8")
    os.replace(sidecar_tmp, sidecar)
    return path, sidecar


def _load_checksummed_json(path: str | Path) -> dict[str, Any]:
    document = Path(path).resolve()
    sidecar = document.with_suffix(document.suffix + ".sha256")
    if not document.exists() or not sidecar.exists():
        raise ContinuousLearningError(f"missing checksummed artifact: {document}")
    expected = sidecar.read_text(encoding="utf-8").strip().split()[0].lower()
    actual = _sha256_file(document)
    if not expected or expected != actual:
        raise ContinuousLearningError(f"checksum mismatch: {document}")
    payload = json.loads(document.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ContinuousLearningError(f"artifact must contain a JSON object: {document}")
    return payload


def _load_phase_manifest(directory: str | Path, name: str) -> dict[str, Any]:
    root = Path(directory).resolve()
    document = root / name
    sidecar = root / name.replace(".json", ".sha256")
    if not document.exists() or not sidecar.exists():
        raise ContinuousLearningError(f"missing checksummed artifact: {document}")
    expected = sidecar.read_text(encoding="utf-8").strip().split()[0].lower()
    actual = _sha256_file(document)
    if expected != actual:
        raise ContinuousLearningError(f"checksum mismatch: {document}")
    return json.loads(document.read_text(encoding="utf-8"))


def validate_phase9_training_dataset(dataset: dict[str, Any]) -> None:
    leakage = dataset.get("leakagePolicy") or {}
    if leakage.get("phase9VerifiedLifecycleRequired") is not True:
        raise ContinuousLearningError(
            "continuous learning requires a feature dataset built with phase9VerifiedLifecycleRequired=true"
        )
    if leakage.get("phase2EligibilityRequired") is not True:
        raise ContinuousLearningError("continuous learning requires the Phase 2 dataset eligibility gate")
    if leakage.get("targetOutcomeExcludedFromFeatures") is not True:
        raise ContinuousLearningError("continuous learning dataset does not declare target-outcome exclusion")
    if not dataset.get("datasetVersion") or not dataset.get("datasetHash"):
        raise ContinuousLearningError("continuous learning dataset is missing version/hash provenance")
    if not dataset.get("rows"):
        raise ContinuousLearningError("continuous learning dataset contains no training rows")


def _selected_candidate(report: dict[str, Any], task: str) -> dict[str, Any]:
    task_report = (report.get("tasks") or {}).get(task) or {}
    selection = task_report.get("selection") or {}
    selected_name = selection.get("selectedCandidate")
    if not selected_name:
        raise ContinuousLearningError(f"evaluation does not select a {task} candidate")
    try:
        candidate = next(item for item in task_report.get("candidates", []) if item.get("candidate") == selected_name)
    except StopIteration as exc:
        raise ContinuousLearningError(f"selected {task} candidate is absent from evaluation") from exc
    return candidate


@dataclass(frozen=True)
class ComparisonThresholds:
    max_brier_absolute_regression: float = 0.02
    max_roc_auc_absolute_regression: float = 0.02
    max_calibration_absolute_regression: float = 0.03
    max_regression_relative_mae_increase: float = 0.05
    max_regression_relative_rmse_increase: float = 0.05


def compare_with_production(
    candidate_report: dict[str, Any],
    production_report: dict[str, Any],
    *,
    candidate_row_count: int,
    production_row_count: int,
    candidate_dataset_hash: str,
    production_dataset_hash: str,
    thresholds: ComparisonThresholds | None = None,
) -> dict[str, Any]:
    thresholds = thresholds or ComparisonThresholds()
    checks: list[dict[str, Any]] = []

    if candidate_dataset_hash == production_dataset_hash:
        checks.append({"check": "new_dataset_hash", "passed": False, "message": "candidate dataset hash equals production training dataset hash"})
    else:
        checks.append({"check": "new_dataset_hash", "passed": True})
    if candidate_row_count <= production_row_count:
        checks.append({
            "check": "verified_dataset_growth",
            "passed": False,
            "message": f"candidate rows {candidate_row_count} must exceed production rows {production_row_count}",
        })
    else:
        checks.append({"check": "verified_dataset_growth", "passed": True, "addedRows": candidate_row_count - production_row_count})

    success_candidate = _selected_candidate(candidate_report, "success")
    success_production = _selected_candidate(production_report, "success")
    c_metrics = success_candidate.get("calibratedMetrics") or {}
    p_metrics = success_production.get("calibratedMetrics") or {}
    c_cal = success_candidate.get("calibratedCalibration") or {}
    p_cal = success_production.get("calibratedCalibration") or {}

    success_checks = [
        (
            "success_brier",
            float(c_metrics["brier"]),
            float(p_metrics["brier"]),
            float(c_metrics["brier"]) <= float(p_metrics["brier"]) + thresholds.max_brier_absolute_regression,
            "lower_is_better",
        ),
        (
            "success_roc_auc",
            float(c_metrics["rocAuc"]),
            float(p_metrics["rocAuc"]),
            float(c_metrics["rocAuc"]) >= float(p_metrics["rocAuc"]) - thresholds.max_roc_auc_absolute_regression,
            "higher_is_better",
        ),
        (
            "success_calibration_ece",
            float(c_cal["expectedCalibrationError"]),
            float(p_cal["expectedCalibrationError"]),
            float(c_cal["expectedCalibrationError"]) <= float(p_cal["expectedCalibrationError"]) + thresholds.max_calibration_absolute_regression,
            "lower_is_better",
        ),
    ]
    for name, candidate_value, production_value, passed, direction in success_checks:
        checks.append({
            "check": name,
            "passed": bool(passed),
            "candidate": candidate_value,
            "production": production_value,
            "delta": candidate_value - production_value,
            "direction": direction,
        })

    for task in ("depth", "yield"):
        candidate = _selected_candidate(candidate_report, task)
        production = _selected_candidate(production_report, task)
        c = candidate.get("metrics") or {}
        p = production.get("metrics") or {}
        for metric, tolerance in (
            ("mae", thresholds.max_regression_relative_mae_increase),
            ("rmse", thresholds.max_regression_relative_rmse_increase),
        ):
            production_value = float(p[metric])
            candidate_value = float(c[metric])
            limit = production_value * (1.0 + tolerance)
            checks.append({
                "check": f"{task}_{metric}",
                "passed": candidate_value <= limit,
                "candidate": candidate_value,
                "production": production_value,
                "relativeChangePct": None if production_value == 0 else ((candidate_value - production_value) / production_value) * 100.0,
                "allowedIncreasePct": tolerance * 100.0,
                "direction": "lower_is_better",
            })

    passed = all(item["passed"] for item in checks)
    return {
        "schemaVersion": CONTINUOUS_LEARNING_SCHEMA_VERSION,
        "status": "ELIGIBLE_FOR_HUMAN_REVIEW" if passed else "HOLD_FOR_REVIEW",
        "automaticPromotion": False,
        "allGuardsPassed": passed,
        "checks": checks,
        "thresholds": asdict(thresholds),
        "candidateDataset": {"hash": candidate_dataset_hash, "rowCount": candidate_row_count},
        "productionDataset": {"hash": production_dataset_hash, "rowCount": production_row_count},
        "important": "Comparison guards are promotion safety checks, not proof that the candidate is scientifically superior. Human review remains mandatory.",
    }


@dataclass(frozen=True)
class ContinuousLearningConfig:
    output_dir: Path
    run_id: str
    seed: int = 42
    min_rows: int = 30
    profile: str = "standard"
    algorithms: tuple[str, ...] = ()
    folds: int = 5
    inner_folds: int = 3
    interval_coverage: float = 0.90
    min_spatial_blocks: int = 5
    calibration_bins: int = 10
    bootstrap_iterations: int = 500
    confidence_level: float = 0.95


def stage_continuous_learning_candidate(
    *,
    dataset_path: str | Path,
    production_phase4_dir: str | Path,
    production_phase5_dir: str | Path,
    feature_manifest_path: str | Path,
    config: ContinuousLearningConfig,
    thresholds: ComparisonThresholds | None = None,
) -> dict[str, Any]:
    dataset_path = Path(dataset_path).resolve()
    feature_manifest_path = Path(feature_manifest_path).resolve()
    dataset = load_feature_dataset(dataset_path)
    validate_phase9_training_dataset(dataset)

    feature_manifest = json.loads(feature_manifest_path.read_text(encoding="utf-8"))
    if feature_manifest.get("datasetVersion") != dataset.get("datasetVersion"):
        raise ContinuousLearningError("feature manifest datasetVersion does not match the training dataset")

    production_phase4 = _load_phase_manifest(production_phase4_dir, "run-manifest.json")
    production_phase5 = _load_phase_manifest(production_phase5_dir, "evaluation-manifest.json")
    if production_phase5.get("phase4RunId") != production_phase4.get("runId"):
        raise ContinuousLearningError("production Phase 4/5 artifacts do not form one reviewed chain")
    if production_phase5.get("blockedTasks"):
        raise ContinuousLearningError("production comparison artifact contains blocked scientific tasks")

    run_root = config.output_dir.resolve() / config.run_id
    if run_root.exists() and any(run_root.iterdir()):
        raise ContinuousLearningError(f"continuous learning run already exists: {run_root}")
    run_root.mkdir(parents=True, exist_ok=True)

    dataset_file_sha = _sha256_file(dataset_path)
    dataset_version = {
        "schemaVersion": CONTINUOUS_LEARNING_SCHEMA_VERSION,
        "id": f"training-dataset-{config.run_id}",
        "createdAt": _utc_now(),
        "source": {
            "datasetVersion": dataset["datasetVersion"],
            "datasetHash": dataset["datasetHash"],
            "datasetFile": str(dataset_path),
            "datasetFileSha256": dataset_file_sha,
            "featureManifest": str(feature_manifest_path),
            "featureManifestSha256": _sha256_file(feature_manifest_path),
        },
        "rowCount": len(dataset["rows"]),
        "phase9VerifiedLifecycleRequired": True,
        "leakagePolicy": dataset.get("leakagePolicy"),
        "status": "FROZEN_FOR_CANDIDATE_TRAINING",
    }
    _write_checksummed_json(run_root / "training-dataset-version.json", dataset_version, refuse_overwrite=True)

    phase4_out = run_root / "phase4"
    phase4_run_id = f"{config.run_id}-candidate"
    candidate_phase4 = train_model_candidates(dataset, TrainingConfig(
        output_dir=phase4_out,
        run_id=phase4_run_id,
        seed=config.seed,
        min_rows=config.min_rows,
        profile=config.profile,
        algorithms=config.algorithms,
    ))
    blocked_training = [task for task, details in candidate_phase4["tasks"].items() if details["status"] == "blocked"]
    if blocked_training:
        raise ContinuousLearningError(f"candidate training blocked for tasks: {', '.join(blocked_training)}")

    phase4_dir = phase4_out / phase4_run_id
    phase5_out = run_root / "phase5"
    evaluation_id = f"{config.run_id}-evaluation"
    candidate_phase5 = evaluate_scientifically(dataset, phase4_dir, ScientificEvaluationConfig(
        output_dir=phase5_out,
        evaluation_id=evaluation_id,
        folds=config.folds,
        inner_folds=config.inner_folds,
        interval_coverage=config.interval_coverage,
        min_rows=config.min_rows,
        min_spatial_blocks=config.min_spatial_blocks,
        calibration_bins=config.calibration_bins,
        bootstrap_iterations=config.bootstrap_iterations,
        confidence_level=config.confidence_level,
        seed=config.seed,
    ))
    if candidate_phase5.get("blockedTasks"):
        raise ContinuousLearningError(
            f"candidate scientific evaluation blocked for tasks: {', '.join(candidate_phase5['blockedTasks'])}"
        )

    production_training = production_phase4.get("trainingDataset") or {}
    comparison = compare_with_production(
        candidate_phase5,
        production_phase5,
        candidate_row_count=len(dataset["rows"]),
        production_row_count=int(production_training.get("rowCount") or 0),
        candidate_dataset_hash=str(dataset["datasetHash"]),
        production_dataset_hash=str(production_training.get("datasetHash") or ""),
        thresholds=thresholds,
    )

    promotion = {
        "schemaVersion": CONTINUOUS_LEARNING_SCHEMA_VERSION,
        "runId": config.run_id,
        "createdAt": _utc_now(),
        "status": "AWAITING_HUMAN_APPROVAL" if comparison["allGuardsPassed"] else "HOLD_FOR_HUMAN_REVIEW",
        "automaticPromotion": False,
        "humanApprovalRequired": True,
        "trainingDatasetVersionArtifact": "training-dataset-version.json",
        "candidate": {
            "phase4RunId": phase4_run_id,
            "phase4RunDir": str(phase4_dir),
            "phase5EvaluationId": evaluation_id,
            "phase5EvaluationDir": str(phase5_out / evaluation_id),
            "modelVersion": f"{phase4_run_id}@{evaluation_id}",
            "featureManifest": str(feature_manifest_path),
            "featureManifestSha256": _sha256_file(feature_manifest_path),
        },
        "production": {
            "phase4RunId": production_phase4.get("runId"),
            "phase4RunDir": str(Path(production_phase4_dir).resolve()),
            "phase5EvaluationId": production_phase5.get("evaluationId"),
            "phase5EvaluationDir": str(Path(production_phase5_dir).resolve()),
            "modelVersion": f"{production_phase4.get('runId')}@{production_phase5.get('evaluationId')}",
        },
        "comparison": comparison,
        "phaseBoundary": {
            "candidateTrained": True,
            "scientificallyEvaluated": True,
            "comparedWithProduction": True,
            "humanApproved": False,
            "deployed": False,
            "automaticProductionReplacement": False,
        },
    }
    promotion_path, sidecar = _write_checksummed_json(run_root / "promotion-candidate.json", promotion, refuse_overwrite=True)
    return {
        **promotion,
        "artifacts": {
            "promotionCandidate": str(promotion_path),
            "promotionCandidateChecksum": str(sidecar),
        },
    }


def approve_candidate(
    *,
    promotion_candidate_path: str | Path,
    reviewer: str,
    reason: str,
    override_comparison_hold: bool = False,
) -> dict[str, Any]:
    reviewer = reviewer.strip()
    reason = reason.strip()
    if len(reviewer) < 2:
        raise ContinuousLearningError("reviewer identity is required")
    if len(reason) < 10:
        raise ContinuousLearningError("approval reason must be at least 10 characters")
    candidate_path = Path(promotion_candidate_path).resolve()
    candidate = _load_checksummed_json(candidate_path)
    if candidate.get("humanApprovalRequired") is not True or candidate.get("automaticPromotion") is not False:
        raise ContinuousLearningError("candidate does not carry the Phase 10 human-approval boundary")
    guards_pass = bool((candidate.get("comparison") or {}).get("allGuardsPassed"))
    if not guards_pass and not override_comparison_hold:
        raise ContinuousLearningError("production-comparison guards are on HOLD; explicit override is required")

    approval = {
        "schemaVersion": CONTINUOUS_LEARNING_SCHEMA_VERSION,
        "runId": candidate["runId"],
        "approvedAt": _utc_now(),
        "approvedBy": reviewer,
        "reason": reason,
        "comparisonGuardsPassed": guards_pass,
        "comparisonOverride": bool(override_comparison_hold),
        "candidateManifest": str(candidate_path),
        "candidateManifestSha256": _sha256_file(candidate_path),
        "modelVersion": candidate["candidate"]["modelVersion"],
        "status": "HUMAN_APPROVED",
        "automaticDeployment": False,
    }
    approval_path = candidate_path.parent / "approval.json"
    _write_checksummed_json(approval_path, approval, refuse_overwrite=True)
    return approval


def stage_deployment(
    *,
    promotion_candidate_path: str | Path,
    approval_path: str | Path,
    deployment_id: str,
    current_pointer_path: str | Path | None = None,
) -> dict[str, Any]:
    candidate_path = Path(promotion_candidate_path).resolve()
    approval_path = Path(approval_path).resolve()
    candidate = _load_checksummed_json(candidate_path)
    approval = _load_checksummed_json(approval_path)
    if approval.get("status") != "HUMAN_APPROVED":
        raise ContinuousLearningError("deployment requires a human-approved candidate")
    if approval.get("candidateManifestSha256") != _sha256_file(candidate_path):
        raise ContinuousLearningError("approval does not match the candidate manifest")
    if approval.get("modelVersion") != candidate.get("candidate", {}).get("modelVersion"):
        raise ContinuousLearningError("approval/model version mismatch")

    rollback_target = None
    if current_pointer_path:
        pointer = Path(current_pointer_path).resolve()
        if pointer.exists():
            current = _load_checksummed_json(pointer)
            rollback_target = {
                "deploymentId": current.get("deploymentId"),
                "modelVersion": current.get("modelVersion"),
                "phase4RunDir": current.get("phase4RunDir"),
                "phase5EvaluationDir": current.get("phase5EvaluationDir"),
                "featureManifest": current.get("featureManifest"),
            }

    staged = {
        "schemaVersion": DEPLOYMENT_SCHEMA_VERSION,
        "deploymentId": deployment_id,
        "createdAt": _utc_now(),
        "status": "STAGED",
        "productionActivated": False,
        "deploymentApproved": True,
        "approvalArtifact": str(approval_path),
        "approvalArtifactSha256": _sha256_file(approval_path),
        "candidateManifest": str(candidate_path),
        "candidateManifestSha256": _sha256_file(candidate_path),
        "modelVersion": candidate["candidate"]["modelVersion"],
        "phase4RunDir": candidate["candidate"]["phase4RunDir"],
        "phase5EvaluationDir": candidate["candidate"]["phase5EvaluationDir"],
        "featureManifest": candidate["candidate"]["featureManifest"],
        "featureManifestSha256": candidate["candidate"]["featureManifestSha256"],
        "rollbackTarget": rollback_target,
        "monitoringRequired": True,
        "automaticRollback": False,
        "activationRequirement": "explicit operator action with confirm=DEPLOY",
    }
    deployment_path = candidate_path.parent / "deployment-staged.json"
    _write_checksummed_json(deployment_path, staged, refuse_overwrite=True)
    return staged


def activate_deployment(
    *,
    staged_deployment_path: str | Path,
    current_pointer_path: str | Path,
    actor: str,
    reason: str,
    confirm: str,
) -> dict[str, Any]:
    if confirm != "DEPLOY":
        raise ContinuousLearningError("deployment activation requires confirm=DEPLOY")
    if len(actor.strip()) < 2 or len(reason.strip()) < 10:
        raise ContinuousLearningError("deployment actor and a meaningful reason are required")
    staged_path = Path(staged_deployment_path).resolve()
    staged = _load_checksummed_json(staged_path)
    if staged.get("status") != "STAGED" or staged.get("deploymentApproved") is not True:
        raise ContinuousLearningError("only an approved STAGED deployment can be activated")

    current_pointer = Path(current_pointer_path).resolve()
    previous = None
    if current_pointer.exists():
        previous = _load_checksummed_json(current_pointer)
        history_dir = current_pointer.parent / "history"
        history_dir.mkdir(parents=True, exist_ok=True)
        history_name = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{previous.get('deploymentId', 'unknown')}.json"
        shutil.copy2(current_pointer, history_dir / history_name)
        sidecar = current_pointer.with_suffix(current_pointer.suffix + ".sha256")
        if sidecar.exists():
            shutil.copy2(sidecar, (history_dir / history_name).with_suffix(".json.sha256"))

    active = {
        **staged,
        "status": "ACTIVE",
        "productionActivated": True,
        "activatedAt": _utc_now(),
        "activatedBy": actor.strip(),
        "activationReason": reason.strip(),
        "stagedDeploymentArtifact": str(staged_path),
        "stagedDeploymentArtifactSha256": _sha256_file(staged_path),
        "previousDeployment": previous,
    }
    _write_checksummed_json(current_pointer, active, refuse_overwrite=False)
    return active


def rollback_deployment(
    *,
    current_pointer_path: str | Path,
    actor: str,
    reason: str,
    confirm: str,
) -> dict[str, Any]:
    if confirm != "ROLLBACK":
        raise ContinuousLearningError("rollback requires confirm=ROLLBACK")
    if len(actor.strip()) < 2 or len(reason.strip()) < 10:
        raise ContinuousLearningError("rollback actor and a meaningful reason are required")
    current_pointer = Path(current_pointer_path).resolve()
    current = _load_checksummed_json(current_pointer)
    previous = current.get("previousDeployment")
    if not isinstance(previous, dict) or not previous.get("modelVersion"):
        raise ContinuousLearningError("current deployment does not contain a rollback target")

    restored = {
        **previous,
        "status": "ACTIVE",
        "productionActivated": True,
        "rollback": {
            "fromDeploymentId": current.get("deploymentId"),
            "fromModelVersion": current.get("modelVersion"),
            "rolledBackAt": _utc_now(),
            "rolledBackBy": actor.strip(),
            "reason": reason.strip(),
        },
        "previousDeployment": None,
    }
    _write_checksummed_json(current_pointer, restored, refuse_overwrite=False)
    return restored


def assess_monitoring_snapshot(
    *,
    current_pointer_path: str | Path,
    metrics: dict[str, Any],
    min_scored: int = 20,
    max_brier: float = 0.30,
    max_depth_mae_ft: float = 150.0,
    max_yield_mae_lpm: float = 60.0,
) -> dict[str, Any]:
    current = _load_checksummed_json(current_pointer_path)
    scored = int(metrics.get("scored") or 0)
    checks = [
        {"metric": "minimum_scored", "passed": scored >= min_scored, "value": scored, "threshold": min_scored},
    ]
    if scored >= min_scored:
        if metrics.get("brier") is not None:
            checks.append({"metric": "brier", "passed": float(metrics["brier"]) <= max_brier, "value": float(metrics["brier"]), "threshold": max_brier})
        if metrics.get("depthMaeFt") is not None:
            checks.append({"metric": "depthMaeFt", "passed": float(metrics["depthMaeFt"]) <= max_depth_mae_ft, "value": float(metrics["depthMaeFt"]), "threshold": max_depth_mae_ft})
        if metrics.get("yieldMaeLpm") is not None:
            checks.append({"metric": "yieldMaeLpm", "passed": float(metrics["yieldMaeLpm"]) <= max_yield_mae_lpm, "value": float(metrics["yieldMaeLpm"]), "threshold": max_yield_mae_lpm})
    degraded = scored >= min_scored and any(not item["passed"] for item in checks[1:])
    return {
        "schemaVersion": CONTINUOUS_LEARNING_SCHEMA_VERSION,
        "generatedAt": _utc_now(),
        "deploymentId": current.get("deploymentId"),
        "modelVersion": current.get("modelVersion"),
        "scored": scored,
        "status": "ROLLBACK_REVIEW_RECOMMENDED" if degraded else ("MONITORING_INSUFFICIENT_DATA" if scored < min_scored else "HEALTHY"),
        "automaticRollback": False,
        "checks": checks,
        "important": "Monitoring can recommend rollback but never performs it automatically.",
    }


def load_runtime_deployment(path: str | Path) -> dict[str, Any]:
    deployment = _load_checksummed_json(path)
    if deployment.get("schemaVersion") != DEPLOYMENT_SCHEMA_VERSION:
        raise ContinuousLearningError("unsupported deployment schema version")
    if deployment.get("status") != "ACTIVE" or deployment.get("productionActivated") is not True:
        raise ContinuousLearningError("deployment pointer is not ACTIVE")
    if deployment.get("deploymentApproved") is not True:
        raise ContinuousLearningError("deployment pointer is not human approved")
    for field in ("phase4RunDir", "phase5EvaluationDir", "featureManifest", "modelVersion"):
        if not str(deployment.get(field) or "").strip():
            raise ContinuousLearningError(f"deployment pointer missing {field}")
    feature_manifest = Path(deployment["featureManifest"]).resolve()
    if _sha256_file(feature_manifest) != str(deployment.get("featureManifestSha256") or "").lower():
        raise ContinuousLearningError("deployment feature manifest checksum mismatch")
    return deployment
