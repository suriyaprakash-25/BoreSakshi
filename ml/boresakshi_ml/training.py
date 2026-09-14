from __future__ import annotations

import hashlib
import json
import platform
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from .data import rows_for_task, task_data_summary, validate_feature_dataset
from .models import build_candidate_pipeline, candidate_specs
from .schema import ALL_FEATURES, FEATURE_SCHEMA_VERSION, MODEL_SCHEMA_VERSION, TASKS


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _package_version(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, np.generic):
        return value.item()
    return str(value)


@dataclass(frozen=True)
class TrainingConfig:
    output_dir: Path
    run_id: str
    seed: int = 42
    min_rows: int = 30
    profile: str = "standard"
    algorithms: tuple[str, ...] = ()


def _validate_task_ready(task: str, y: np.ndarray, min_rows: int) -> list[str]:
    errors: list[str] = []
    if len(y) < min_rows:
        errors.append(f"requires at least {min_rows} labelled rows; found {len(y)}")
    if task == "success":
        classes = np.unique(y)
        if len(classes) < 2:
            errors.append("success classification requires both success and failure labels")
    elif len(y) and len(np.unique(y)) < 2:
        errors.append(f"{task} regression requires at least two distinct target values")
    return errors


def _candidate_allowed(name: str, algorithms: tuple[str, ...]) -> bool:
    return not algorithms or name in algorithms


def train_model_candidates(dataset: dict[str, Any], config: TrainingConfig) -> dict[str, Any]:
    validate_feature_dataset(dataset)
    if config.profile not in {"standard", "test"}:
        raise ValueError("profile must be 'standard' or 'test'")
    if config.min_rows < 2:
        raise ValueError("min_rows must be at least 2")

    run_dir = config.output_dir / config.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {
        "modelSchemaVersion": MODEL_SCHEMA_VERSION,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "runId": config.run_id,
        "createdAt": _utc_now(),
        "trainingDataset": {
            "datasetVersion": dataset["datasetVersion"],
            "datasetHash": dataset["datasetHash"],
            "manifestSha256": dataset.get("manifestSha256"),
            "rowCount": len(dataset["rows"]),
        },
        "featureContract": {
            "featureNames": ALL_FEATURES,
            "featureCount": len(ALL_FEATURES),
            "coordinatesUsedDirectly": False,
            "labelsSeparatedFromFeatures": True,
        },
        "trainingConfig": {
            "seed": config.seed,
            "minRows": config.min_rows,
            "profile": config.profile,
            "requestedAlgorithms": list(config.algorithms),
        },
        "environment": {
            "python": platform.python_version(),
            "scikitLearn": _package_version("scikit-learn"),
            "numpy": _package_version("numpy"),
            "pandas": _package_version("pandas"),
            "joblib": _package_version("joblib"),
            "xgboost": _package_version("xgboost"),
            "lightgbm": _package_version("lightgbm"),
        },
        "tasks": {},
        "phaseBoundary": {
            "performanceMetricsPublished": False,
            "candidateSelected": False,
            "selectionOwner": "Phase 5 scientific evaluation",
            "liveApiIntegration": False,
            "integrationOwner": "Phase 6 Python ML service",
        },
    }

    for task, task_contract in TASKS.items():
        X, y, eligible_rows = rows_for_task(dataset, task)
        task_summary = task_data_summary(dataset, task)
        readiness_errors = _validate_task_ready(task, y, config.min_rows)
        task_entry: dict[str, Any] = {
            "kind": task_contract["kind"],
            "label": task_contract["label"],
            "output": task_contract["output"],
            "dataSummary": task_summary,
            "status": "blocked" if readiness_errors else "trained_candidates",
            "readinessErrors": readiness_errors,
            "candidates": [],
        }
        manifest["tasks"][task] = task_entry
        if readiness_errors:
            continue

        task_dir = run_dir / task
        task_dir.mkdir(parents=True, exist_ok=True)
        task_entry["trainingSpatialBlocks"] = sorted({row["spatialBlockId"] for row in eligible_rows})

        for spec in candidate_specs(task, seed=config.seed, profile=config.profile):
            if not _candidate_allowed(spec.name, config.algorithms):
                continue
            candidate: dict[str, Any] = {
                "name": spec.name,
                "algorithm": spec.algorithm,
                "status": "unavailable" if not spec.available else "pending",
                "evaluationStatus": "not_evaluated_phase5",
                "selected": False,
                "trainedRows": len(y),
                "artifact": None,
            }
            if not spec.available:
                candidate["unavailableReason"] = spec.unavailable_reason or "optional dependency unavailable"
                task_entry["candidates"].append(candidate)
                continue

            pipeline = build_candidate_pipeline(spec)
            pipeline.fit(X, y)
            artifact_path = task_dir / f"{spec.name}.joblib"
            joblib.dump(pipeline, artifact_path, compress=3)
            model = pipeline.named_steps["model"]
            candidate.update({
                "status": "trained",
                "hyperparameters": _json_safe(model.get_params(deep=False)),
                "artifact": {
                    "path": str(artifact_path.relative_to(config.output_dir)).replace("\\", "/"),
                    "sha256": _sha256_file(artifact_path),
                    "byteSize": artifact_path.stat().st_size,
                    "format": "joblib",
                },
            })
            task_entry["candidates"].append(candidate)

        if not any(c["status"] == "trained" for c in task_entry["candidates"]):
            task_entry["status"] = "blocked"
            task_entry["readinessErrors"].append("no requested candidate algorithm could be trained")

    manifest_path = run_dir / "run-manifest.json"
    checksum_path = run_dir / "run-manifest.sha256"
    manifest["manifestArtifact"] = {
        "path": str(manifest_path.relative_to(config.output_dir)).replace("\\", "/"),
        "checksumPath": str(checksum_path.relative_to(config.output_dir)).replace("\\", "/"),
        "checksumAlgorithm": "sha256",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    manifest_sha256 = _sha256_file(manifest_path)
    checksum_path.write_text(f"{manifest_sha256}  {manifest_path.name}\n", encoding="utf-8")
    manifest["manifestArtifact"]["sha256"] = manifest_sha256
    manifest["manifestArtifact"]["byteSize"] = manifest_path.stat().st_size
    return manifest


def trained_candidate_names(manifest: dict[str, Any], task: str) -> list[str]:
    return [
        candidate["name"]
        for candidate in manifest["tasks"][task]["candidates"]
        if candidate["status"] == "trained"
    ]
