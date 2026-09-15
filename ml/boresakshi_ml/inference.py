from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from .schema import ALL_FEATURES, CATEGORICAL_FEATURES, NUMERIC_FEATURES


def _single_row(features: dict[str, Any]) -> pd.DataFrame:
    missing = [name for name in ALL_FEATURES if name not in features]
    if missing:
        raise ValueError(f"missing required feature keys: {missing}")
    row: dict[str, Any] = {}
    for name in NUMERIC_FEATURES:
        value = features.get(name)
        row[name] = None if value is None else float(value)
    for name in CATEGORICAL_FEATURES:
        value = features.get(name)
        row[name] = None if value is None or value == "" else str(value)
    return pd.DataFrame([row], columns=ALL_FEATURES)


def load_candidate(path: str | Path):
    return joblib.load(path)


def predict_candidate(model, task: str, features: dict[str, Any]) -> dict[str, float]:
    X = _single_row(features)
    if task == "success":
        if not hasattr(model, "predict_proba"):
            raise ValueError("success model must expose predict_proba")
        probability = float(model.predict_proba(X)[0][1])
        return {"successProbability": probability}
    value = float(model.predict(X)[0])
    if task == "depth":
        return {"estimatedWaterStrikeFt": value}
    if task == "yield":
        return {"estimatedYieldLpm": value}
    raise ValueError(f"unknown task {task!r}")
