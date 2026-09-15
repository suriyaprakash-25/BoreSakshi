from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, StratifiedGroupKFold

from .data import feature_frame, rows_for_task, task_data_summary, validate_feature_dataset
from .metrics import (
    calibration_report,
    classification_metrics,
    classification_uncertainty,
    conformal_quantile,
    interval_report,
    regression_metrics,
)
from .schema import ALL_FEATURES, MODEL_SCHEMA_VERSION, TASKS


class EvaluationContractError(ValueError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: Any) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, indent=2, sort_keys=True) + "\n"
    path.write_text(text, encoding="utf-8")
    return {
        "path": path.name,
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "byteSize": len(text.encode("utf-8")),
    }


def _logit(probabilities: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(probabilities, dtype=float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p)).reshape(-1, 1)


@dataclass(frozen=True)
class EvaluationConfig:
    output_dir: Path
    evaluation_id: str
    folds: int = 5
    inner_folds: int = 3
    interval_coverage: float = 0.90
    min_rows: int = 30
    min_spatial_blocks: int = 5
    calibration_bins: int = 10
    seed: int = 42


def load_phase4_manifest(run_dir: str | Path, dataset: dict[str, Any]) -> dict[str, Any]:
    run_path = Path(run_dir)
    manifest_path = run_path / "run-manifest.json"
    checksum_path = run_path / "run-manifest.sha256"
    if not manifest_path.exists() or not checksum_path.exists():
        raise EvaluationContractError("Phase 4 run-manifest.json and run-manifest.sha256 are required")

    actual = _sha256_file(manifest_path)
    expected = checksum_path.read_text(encoding="utf-8").strip().split()[0].lower()
    if actual != expected:
        raise EvaluationContractError("Phase 4 run manifest checksum mismatch")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("modelSchemaVersion") != MODEL_SCHEMA_VERSION:
        raise EvaluationContractError("unsupported Phase 4 model schema version")
    source = manifest.get("trainingDataset") or {}
    if source.get("datasetVersion") != dataset.get("datasetVersion"):
        raise EvaluationContractError("Phase 4 run datasetVersion does not match evaluation dataset")
    if source.get("datasetHash") != dataset.get("datasetHash"):
        raise EvaluationContractError("Phase 4 run datasetHash does not match evaluation dataset")
    if manifest.get("featureSchemaVersion") != dataset.get("featureSchemaVersion"):
        raise EvaluationContractError("Phase 4 feature schema does not match evaluation dataset")
    return manifest


def _artifact_path(run_dir: Path, artifact: dict[str, Any]) -> Path:
    # Phase 4 stores paths relative to the output directory, one level above run_dir.
    path = run_dir.parent / str(artifact.get("path") or "")
    if not path.exists():
        raise EvaluationContractError(f"candidate artifact missing: {path}")
    expected = str(artifact.get("sha256") or "").lower()
    if not expected or _sha256_file(path) != expected:
        raise EvaluationContractError(f"candidate artifact checksum mismatch: {path}")
    return path


def _candidate_models(run_dir: Path, manifest: dict[str, Any], task: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for candidate in manifest["tasks"][task]["candidates"]:
        if candidate.get("status") != "trained":
            continue
        artifact = candidate.get("artifact") or {}
        path = _artifact_path(run_dir, artifact)
        candidates.append({
            "name": candidate["name"],
            "algorithm": candidate["algorithm"],
            "artifact": artifact,
            "pipeline": joblib.load(path),
        })
    return candidates


def _outer_splits(task: str, X, y: np.ndarray, groups: np.ndarray, folds: int, seed: int):
    unique_groups = len(np.unique(groups))
    n_splits = min(folds, unique_groups)
    if n_splits < 2:
        raise EvaluationContractError("at least two spatial blocks are required for grouped evaluation")
    if task == "success":
        splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
        return list(splitter.split(X, y, groups)), n_splits
    splitter = GroupKFold(n_splits=n_splits)
    return list(splitter.split(X, y, groups)), n_splits


def _inner_oof_predictions(
    pipeline,
    task: str,
    X,
    y: np.ndarray,
    groups: np.ndarray,
    inner_folds: int,
    seed: int,
) -> tuple[np.ndarray | None, str]:
    unique_groups = len(np.unique(groups))
    n_splits = min(inner_folds, unique_groups)
    if n_splits < 2:
        return None, "insufficient_inner_spatial_blocks"
    try:
        if task == "success":
            splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
            splits = list(splitter.split(X, y, groups))
        else:
            splits = list(GroupKFold(n_splits=n_splits).split(X, y, groups))
    except ValueError as exc:
        return None, f"inner_split_failed:{exc}"

    predictions = np.full(len(y), np.nan, dtype=float)
    for train_idx, valid_idx in splits:
        if task == "success" and len(np.unique(y[train_idx])) < 2:
            return None, "inner_training_fold_missing_class"
        model = clone(pipeline)
        model.fit(X.iloc[train_idx], y[train_idx])
        if task == "success":
            predictions[valid_idx] = model.predict_proba(X.iloc[valid_idx])[:, 1]
        else:
            predictions[valid_idx] = model.predict(X.iloc[valid_idx])
    if not np.isfinite(predictions).all():
        return None, "inner_oof_incomplete"
    return predictions, "ok"


def _task_readiness(task: str, y: np.ndarray, rows: list[dict[str, Any]], config: EvaluationConfig) -> list[str]:
    errors: list[str] = []
    if len(y) < config.min_rows:
        errors.append(f"requires at least {config.min_rows} labelled rows; found {len(y)}")
    groups = np.asarray([row["spatialBlockId"] for row in rows], dtype=object)
    block_count = len(np.unique(groups))
    if block_count < config.min_spatial_blocks:
        errors.append(f"requires at least {config.min_spatial_blocks} spatial blocks; found {block_count}")
    if task == "success":
        classes = np.unique(y)
        if len(classes) < 2:
            errors.append("success evaluation requires both classes")
        else:
            for klass in classes:
                class_blocks = len(np.unique(groups[y == klass]))
                if class_blocks < 2:
                    errors.append(f"class {int(klass)} occurs in fewer than two spatial blocks")
    elif len(y) and len(np.unique(y)) < 2:
        errors.append(f"{task} evaluation requires at least two distinct target values")
    return errors


def _coverage_report(dataset: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    missing_by_feature: dict[str, int] = {name: 0 for name in ALL_FEATURES}
    block_counts: dict[str, int] = {}
    lats: list[float] = []
    lngs: list[float] = []
    dates: list[str] = []
    row_coverage: list[float] = []
    for row in rows:
        block = str(row["spatialBlockId"])
        block_counts[block] = block_counts.get(block, 0) + 1
        if isinstance(row.get("lat"), (int, float)):
            lats.append(float(row["lat"]))
        if isinstance(row.get("lng"), (int, float)):
            lngs.append(float(row["lng"]))
        if row.get("asOf"):
            dates.append(str(row["asOf"]))
        coverage = row.get("coverage", {}).get("coveragePct")
        if isinstance(coverage, (int, float)):
            row_coverage.append(float(coverage))
        for name in ALL_FEATURES:
            value = row["features"].get(name)
            if value is None or value == "" or (isinstance(value, float) and not math.isfinite(value)):
                missing_by_feature[name] += 1
    count = len(rows)
    return {
        "datasetVersion": dataset.get("datasetVersion"),
        "datasetHash": dataset.get("datasetHash"),
        "eligibleRows": count,
        "spatialBlockCount": len(block_counts),
        "rowsPerSpatialBlock": dict(sorted(block_counts.items())),
        "geographicBounds": {
            "minLat": min(lats) if lats else None,
            "maxLat": max(lats) if lats else None,
            "minLng": min(lngs) if lngs else None,
            "maxLng": max(lngs) if lngs else None,
        },
        "temporalCoverage": {
            "earliestAsOf": min(dates) if dates else None,
            "latestAsOf": max(dates) if dates else None,
        },
        "averagePhase3CoveragePct": float(np.mean(row_coverage)) if row_coverage else None,
        "featureMissingPct": {
            name: float(100 * missing / count) if count else 0.0
            for name, missing in missing_by_feature.items()
        },
    }


def _block_metrics(task: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    by_block: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        by_block.setdefault(record["spatialBlockId"], []).append(record)
    report: dict[str, Any] = {}
    for block, items in sorted(by_block.items()):
        actual = np.asarray([item["actual"] for item in items])
        prediction = np.asarray([item["prediction"] for item in items], dtype=float)
        if task == "success":
            metrics = classification_metrics(actual.astype(int), prediction)
            metrics["positiveRows"] = int(np.sum(actual == 1))
            metrics["negativeRows"] = int(np.sum(actual == 0))
        else:
            metrics = regression_metrics(actual.astype(float), prediction)
        report[block] = {"rows": len(items), "metrics": metrics}
    return report


def _evaluate_candidate(
    task: str,
    candidate: dict[str, Any],
    X,
    y: np.ndarray,
    rows: list[dict[str, Any]],
    config: EvaluationConfig,
) -> dict[str, Any]:
    groups = np.asarray([row["spatialBlockId"] for row in rows], dtype=object)
    splits, actual_folds = _outer_splits(task, X, y, groups, config.folds, config.seed)
    raw = np.full(len(y), np.nan, dtype=float)
    adjusted = np.full(len(y), np.nan, dtype=float)
    lower = np.full(len(y), np.nan, dtype=float)
    upper = np.full(len(y), np.nan, dtype=float)
    fold_assignments = np.full(len(y), -1, dtype=int)
    fold_reports: list[dict[str, Any]] = []
    fallback_count = 0

    for fold_number, (train_idx, test_idx) in enumerate(splits, start=1):
        base = clone(candidate["pipeline"])
        base.fit(X.iloc[train_idx], y[train_idx])
        fold_assignments[test_idx] = fold_number

        if task == "success":
            p_raw = base.predict_proba(X.iloc[test_idx])[:, 1]
            raw[test_idx] = p_raw
            inner, inner_status = _inner_oof_predictions(
                candidate["pipeline"], task, X.iloc[train_idx].reset_index(drop=True), y[train_idx], groups[train_idx], config.inner_folds, config.seed + fold_number
            )
            if inner is not None and len(np.unique(y[train_idx])) == 2:
                calibrator = LogisticRegression(max_iter=2000, solver="lbfgs")
                calibrator.fit(_logit(inner), y[train_idx])
                p_adjusted = calibrator.predict_proba(_logit(p_raw))[:, 1]
            else:
                p_adjusted = p_raw
                fallback_count += 1
            adjusted[test_idx] = p_adjusted
            fold_reports.append({
                "fold": fold_number,
                "testRows": len(test_idx),
                "testSpatialBlocks": sorted(set(groups[test_idx].tolist())),
                "rawMetrics": classification_metrics(y[test_idx], p_raw),
                "calibratedMetrics": classification_metrics(y[test_idx], p_adjusted),
                "calibrationStatus": inner_status,
            })
        else:
            point = np.asarray(base.predict(X.iloc[test_idx]), dtype=float)
            raw[test_idx] = point
            adjusted[test_idx] = point
            inner, inner_status = _inner_oof_predictions(
                candidate["pipeline"], task, X.iloc[train_idx].reset_index(drop=True), y[train_idx], groups[train_idx], config.inner_folds, config.seed + fold_number
            )
            radius = None
            if inner is not None:
                radius = conformal_quantile(np.abs(y[train_idx] - inner), config.interval_coverage)
                lower[test_idx] = np.maximum(0.0, point - radius)
                upper[test_idx] = np.maximum(0.0, point + radius)
            else:
                fallback_count += 1
            fold_reports.append({
                "fold": fold_number,
                "testRows": len(test_idx),
                "testSpatialBlocks": sorted(set(groups[test_idx].tolist())),
                "metrics": regression_metrics(y[test_idx], point),
                "intervalRadius": radius,
                "intervalStatus": inner_status,
            })

    if not np.isfinite(raw).all():
        raise EvaluationContractError(f"OOF predictions incomplete for {task}/{candidate['name']}")

    predictions: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        item = {
            "targetId": row["targetId"],
            "spatialBlockId": row["spatialBlockId"],
            "fold": int(fold_assignments[index]),
            "actual": int(y[index]) if task == "success" else float(y[index]),
            "rawPrediction": float(raw[index]),
        }
        if task == "success":
            item["prediction"] = float(adjusted[index])
        else:
            item["prediction"] = float(raw[index])
            item["lower"] = float(lower[index]) if np.isfinite(lower[index]) else None
            item["upper"] = float(upper[index]) if np.isfinite(upper[index]) else None
        predictions.append(item)

    if task == "success":
        raw_metrics = classification_metrics(y, raw)
        calibrated_metrics = classification_metrics(y, adjusted)
        result = {
            "status": "evaluated",
            "candidate": candidate["name"],
            "algorithm": candidate["algorithm"],
            "sourceArtifact": candidate["artifact"],
            "folds": actual_folds,
            "rawMetrics": raw_metrics,
            "calibratedMetrics": calibrated_metrics,
            "rawCalibration": calibration_report(y, raw, config.calibration_bins),
            "calibratedCalibration": calibration_report(y, adjusted, config.calibration_bins),
            "uncertainty": classification_uncertainty(adjusted, y),
            "calibrationFallbackFolds": fallback_count,
            "foldReports": fold_reports,
            "spatialBlockMetrics": _block_metrics(task, predictions),
            "oofPredictions": predictions,
        }
        raw_brier = raw_metrics.get("brier")
        calibrated_brier = calibrated_metrics.get("brier")
        result["calibrationDeltaBrier"] = (
            float(raw_brier - calibrated_brier)
            if raw_brier is not None and calibrated_brier is not None
            else None
        )
        return result

    return {
        "status": "evaluated",
        "candidate": candidate["name"],
        "algorithm": candidate["algorithm"],
        "sourceArtifact": candidate["artifact"],
        "folds": actual_folds,
        "metrics": regression_metrics(y, raw),
        "intervals": interval_report(y, lower, upper, config.interval_coverage),
        "intervalFallbackFolds": fallback_count,
        "foldReports": fold_reports,
        "spatialBlockMetrics": _block_metrics(task, predictions),
        "oofPredictions": predictions,
    }


def _select_candidate(task: str, candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    evaluated = [candidate for candidate in candidates if candidate.get("status") == "evaluated"]
    if not evaluated:
        return None
    if task == "success":
        def key(candidate):
            metrics = candidate["calibratedMetrics"]
            return (
                metrics.get("brier") if metrics.get("brier") is not None else float("inf"),
                -(metrics.get("rocAuc") if metrics.get("rocAuc") is not None else -1.0),
                -(metrics.get("f1") if metrics.get("f1") is not None else -1.0),
                candidate["candidate"],
            )
        selected = min(evaluated, key=key)
        rationale = "lowest spatial-OOF calibrated Brier score; ROC-AUC then F1 used as tie-breakers"
        snapshot = selected["calibratedMetrics"]
    else:
        def key(candidate):
            metrics = candidate["metrics"]
            return (
                metrics.get("mae") if metrics.get("mae") is not None else float("inf"),
                metrics.get("rmse") if metrics.get("rmse") is not None else float("inf"),
                -(metrics.get("r2") if metrics.get("r2") is not None else -float("inf")),
                candidate["candidate"],
            )
        selected = min(evaluated, key=key)
        rationale = "lowest spatial-OOF MAE; RMSE then R² used as tie-breakers"
        snapshot = selected["metrics"]
    return {
        "selectedCandidate": selected["candidate"],
        "algorithm": selected["algorithm"],
        "selectionRationale": rationale,
        "metricsSnapshot": snapshot,
        "servingApproved": False,
        "promotionStatus": "scientifically_selected_pending_review",
    }


def _selected_candidate_report(task_report: dict[str, Any], selection: dict[str, Any]) -> dict[str, Any]:
    name = selection["selectedCandidate"]
    return next(candidate for candidate in task_report["candidates"] if candidate["candidate"] == name)


def _create_selected_auxiliary_artifacts(
    evaluation_dir: Path,
    task: str,
    task_report: dict[str, Any],
    selection: dict[str, Any],
    y: np.ndarray,
    config: EvaluationConfig,
) -> dict[str, Any]:
    selected = _selected_candidate_report(task_report, selection)
    records = selected["oofPredictions"]
    if task == "success":
        raw = np.asarray([record["rawPrediction"] for record in records], dtype=float)
        calibrator = LogisticRegression(max_iter=2000, solver="lbfgs")
        calibrator.fit(_logit(raw), y.astype(int))
        path = evaluation_dir / "selected" / task / "platt-calibrator.joblib"
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(calibrator, path, compress=3)
        return {
            "baseModelArtifact": selected["sourceArtifact"],
            "calibration": {
                "method": "platt_on_spatial_oof_logits",
                "artifact": {
                    "path": str(path.relative_to(evaluation_dir)).replace("\\", "/"),
                    "sha256": _sha256_file(path),
                    "byteSize": path.stat().st_size,
                    "format": "joblib",
                },
            },
        }

    prediction = np.asarray([record["rawPrediction"] for record in records], dtype=float)
    radius = conformal_quantile(np.abs(y.astype(float) - prediction), config.interval_coverage)
    metadata = {
        "method": "absolute_residual_conformal_from_spatial_oof",
        "targetCoverage": config.interval_coverage,
        "radius": radius,
        "nonNegativeLowerBound": True,
        "label": TASKS[task]["label"],
    }
    path = evaluation_dir / "selected" / task / "interval.json"
    artifact = _write_json(path, metadata)
    return {
        "baseModelArtifact": selected["sourceArtifact"],
        "uncertainty": {**metadata, "artifact": artifact},
    }


def _markdown_report(report: dict[str, Any]) -> str:
    lines = [
        f"# BoreSakshi Phase 5 Evaluation — {report['evaluationId']}",
        "",
        f"Dataset: `{report['trainingDataset']['datasetVersion']}` / `{report['trainingDataset']['datasetHash']}`",
        "",
        "This report contains measured spatial out-of-fold metrics. Serving remains disabled until review and Phase 6 integration.",
        "",
    ]
    for task, details in report["tasks"].items():
        lines.extend([f"## {task.title()}", ""])
        if details["status"] != "evaluated":
            lines.append("Blocked: " + "; ".join(details.get("readinessErrors") or []))
            lines.append("")
            continue
        selection = details["selection"]
        lines.append(f"Selected candidate: **{selection['selectedCandidate']}**")
        lines.append("")
        lines.append(f"Selection rule: {selection['selectionRationale']}")
        lines.append("")
        lines.append("Measured metrics: `" + json.dumps(selection["metricsSnapshot"], sort_keys=True) + "`")
        lines.append("")
    return "\n".join(lines) + "\n"


def evaluate_phase4_run(
    dataset: dict[str, Any],
    phase4_run_dir: str | Path,
    config: EvaluationConfig,
) -> dict[str, Any]:
    validate_feature_dataset(dataset)
    if config.folds < 2 or config.inner_folds < 2:
        raise ValueError("fold counts must be at least 2")
    if not 0.5 < config.interval_coverage < 1.0:
        raise ValueError("interval_coverage must be between 0.5 and 1")

    run_dir = Path(phase4_run_dir)
    phase4 = load_phase4_manifest(run_dir, dataset)
    evaluation_dir = config.output_dir / config.evaluation_id
    evaluation_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, Any] = {
        "evaluationSchemaVersion": "1.0.0",
        "evaluationId": config.evaluation_id,
        "createdAt": _utc_now(),
        "phase4RunId": phase4["runId"],
        "trainingDataset": phase4["trainingDataset"],
        "methodology": {
            "outerSplit": "spatial_grouped_out_of_fold",
            "classificationSplitter": "StratifiedGroupKFold",
            "regressionSplitter": "GroupKFold",
            "requestedFolds": config.folds,
            "innerFolds": config.inner_folds,
            "classificationCalibration": "Platt scaling fitted only on inner spatial OOF training predictions",
            "regressionIntervals": "absolute-residual conformal radius fitted only on inner spatial OOF training predictions",
            "intervalCoverage": config.interval_coverage,
            "selectionUsesTrainingFitMetrics": False,
        },
        "config": {
            "folds": config.folds,
            "innerFolds": config.inner_folds,
            "intervalCoverage": config.interval_coverage,
            "minRows": config.min_rows,
            "minSpatialBlocks": config.min_spatial_blocks,
            "calibrationBins": config.calibration_bins,
            "seed": config.seed,
        },
        "tasks": {},
        "servingApproved": False,
        "phaseBoundary": {
            "scientificEvaluationComplete": True,
            "selectionRequiresReview": True,
            "liveApiIntegration": False,
            "integrationOwner": "Phase 6 Python ML service",
        },
    }

    for task in TASKS:
        X, y, rows = rows_for_task(dataset, task)
        readiness = _task_readiness(task, y, rows, config)
        task_report: dict[str, Any] = {
            "status": "blocked" if readiness else "evaluated",
            "readinessErrors": readiness,
            "dataSummary": task_data_summary(dataset, task),
            "coverage": _coverage_report(dataset, rows),
            "candidates": [],
            "selection": None,
            "selectedAuxiliaryArtifacts": None,
        }
        report["tasks"][task] = task_report
        if readiness:
            continue

        candidates = _candidate_models(run_dir, phase4, task)
        if not candidates:
            task_report["status"] = "blocked"
            task_report["readinessErrors"].append("no trained Phase 4 candidates available")
            continue

        for candidate in candidates:
            task_report["candidates"].append(_evaluate_candidate(task, candidate, X, y, rows, config))

        selection = _select_candidate(task, task_report["candidates"])
        task_report["selection"] = selection
        if selection is None:
            task_report["status"] = "blocked"
            task_report["readinessErrors"].append("no candidate produced valid evaluation metrics")
            continue
        task_report["selectedAuxiliaryArtifacts"] = _create_selected_auxiliary_artifacts(
            evaluation_dir, task, task_report, selection, y, config
        )

    blocked_tasks = [task for task, details in report["tasks"].items() if details["status"] != "evaluated"]
    report["phaseBoundary"]["scientificEvaluationComplete"] = not blocked_tasks
    report["blockedTasks"] = blocked_tasks

    manifest_path = evaluation_dir / "evaluation-manifest.json"
    report_path = evaluation_dir / "evaluation-report.md"
    checksum_path = evaluation_dir / "evaluation-manifest.sha256"
    manifest_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    report_path.write_text(_markdown_report(report), encoding="utf-8")
    manifest_sha = _sha256_file(manifest_path)
    checksum_path.write_text(f"{manifest_sha}  {manifest_path.name}\n", encoding="utf-8")
    report["artifacts"] = {
        "manifest": {
            "path": manifest_path.name,
            "sha256": manifest_sha,
            "byteSize": manifest_path.stat().st_size,
        },
        "humanReport": {
            "path": report_path.name,
            "sha256": _sha256_file(report_path),
            "byteSize": report_path.stat().st_size,
        },
        "manifestChecksum": {"path": checksum_path.name},
    }
    return report
