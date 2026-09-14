from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .schema import ALL_FEATURES, CATEGORICAL_FEATURES, FEATURE_SCHEMA_VERSION, NUMERIC_FEATURES, TASKS


class DatasetContractError(ValueError):
    pass


def load_feature_dataset(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        dataset = json.load(handle)
    validate_feature_dataset(dataset)
    return dataset


def validate_feature_dataset(dataset: dict[str, Any]) -> None:
    if not isinstance(dataset, dict):
        raise DatasetContractError("feature dataset must be a JSON object")
    if dataset.get("featureSchemaVersion") != FEATURE_SCHEMA_VERSION:
        raise DatasetContractError(
            f"featureSchemaVersion must be {FEATURE_SCHEMA_VERSION}; got {dataset.get('featureSchemaVersion')!r}"
        )
    if not str(dataset.get("datasetVersion") or "").strip():
        raise DatasetContractError("datasetVersion is required")
    if not str(dataset.get("datasetHash") or "").strip():
        raise DatasetContractError("datasetHash is required")
    rows = dataset.get("rows")
    if not isinstance(rows, list) or not rows:
        raise DatasetContractError("rows must be a non-empty array")

    seen_ids: set[str] = set()
    forbidden_feature_keys = {"success", "depthFt", "waterStrikeFt", "yieldLpm", "labels"}
    for index, row in enumerate(rows):
        prefix = f"rows[{index}]"
        target_id = str(row.get("targetId") or "").strip()
        if not target_id:
            raise DatasetContractError(f"{prefix}.targetId is required")
        if target_id in seen_ids:
            raise DatasetContractError(f"duplicate targetId {target_id!r}")
        seen_ids.add(target_id)
        if not str(row.get("spatialBlockId") or "").strip():
            raise DatasetContractError(f"{prefix}.spatialBlockId is required for Phase 5 spatial validation")
        features = row.get("features")
        if not isinstance(features, dict):
            raise DatasetContractError(f"{prefix}.features must be an object")
        leaked = forbidden_feature_keys.intersection(features)
        if leaked:
            raise DatasetContractError(f"{prefix}.features contains label/leakage keys: {sorted(leaked)}")
        missing = [name for name in ALL_FEATURES if name not in features]
        if missing:
            raise DatasetContractError(f"{prefix}.features missing schema fields: {missing}")
        labels = row.get("labels")
        if not isinstance(labels, dict):
            raise DatasetContractError(f"{prefix}.labels must be an object")
        if not isinstance(labels.get("success"), bool):
            raise DatasetContractError(f"{prefix}.labels.success must be boolean")


def _finite_or_nan(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return np.nan
    return numeric if np.isfinite(numeric) else np.nan


def feature_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    records: list[dict[str, Any]] = []
    for row in rows:
        features = row["features"]
        record: dict[str, Any] = {}
        for name in NUMERIC_FEATURES:
            record[name] = _finite_or_nan(features.get(name))
        for name in CATEGORICAL_FEATURES:
            value = features.get(name)
            record[name] = None if value is None or value == "" else str(value)
        records.append(record)
    return pd.DataFrame(records, columns=ALL_FEATURES)


def rows_for_task(dataset: dict[str, Any], task: str) -> tuple[pd.DataFrame, np.ndarray, list[dict[str, Any]]]:
    if task not in TASKS:
        raise DatasetContractError(f"unknown task {task!r}")
    label_name = TASKS[task]["label"]
    eligible: list[dict[str, Any]] = []
    labels: list[float | int] = []

    for row in dataset["rows"]:
        value = row["labels"].get(label_name)
        if task == "success":
            if isinstance(value, bool):
                eligible.append(row)
                labels.append(int(value))
            continue
        numeric = _finite_or_nan(value)
        if np.isfinite(numeric):
            eligible.append(row)
            labels.append(float(numeric))

    X = feature_frame(eligible)
    dtype = int if task == "success" else float
    y = np.asarray(labels, dtype=dtype)
    return X, y, eligible


def task_data_summary(dataset: dict[str, Any], task: str) -> dict[str, Any]:
    _, y, rows = rows_for_task(dataset, task)
    summary: dict[str, Any] = {
        "task": task,
        "eligibleRows": len(rows),
        "inputRows": len(dataset["rows"]),
        "spatialBlockCount": len({row["spatialBlockId"] for row in rows}),
    }
    if task == "success":
        positives = int(np.sum(y == 1))
        negatives = int(np.sum(y == 0))
        summary.update({"positiveRows": positives, "negativeRows": negatives})
    elif len(y):
        summary.update({
            "labelMin": float(np.min(y)),
            "labelMax": float(np.max(y)),
            "labelMedian": float(np.median(y)),
        })
    return summary
