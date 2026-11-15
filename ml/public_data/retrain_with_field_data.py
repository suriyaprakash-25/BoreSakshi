"""Train the borewell outcome model once field records exist.

  python retrain_with_field_data.py field_records.csv

Each record is a real drilling result from a field visit, in the columns of
field_records_template.csv. The groundwater model's map becomes input features, so the
new model learns what turns groundwater conditions into water or a dry hole.

It always prints an honest test. It saves a model only if the release gates pass.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GroupKFold, KFold
from sklearn.neighbors import BallTree

from config import DATA_DIR, GW_MAP

MIN_RECORDS = 300
MIN_DRY_HOLES = 60
MIN_BLOCKS = 15
MAX_CALIBRATION_ERROR = 0.05
MAX_MAP_DISTANCE_KM = 1.5
BLOCK_DEG = 0.1
OUTCOME_MODEL = DATA_DIR / "gw_model" / "borewell_outcome_model.joblib"
REQUIRED = ["latitude", "longitude", "drilled_date", "outcome"]
GRADE_WEIGHT = {"G1": 1.0, "G2": 0.7, "G3": 0.4}
MAP_FEATURES = ["pre_m", "post_m", "rise_m", "chance_within_10m", "elevation_m"]
SITE_FEATURES = ["slope", "twi", "hand_m", "tpi_500m", "drain_distance_m", "line_density_1km", "soilgrids_bedrock_cm", "rain_mean_mm",
                 "ndvi_dry", "lst_dry_k", "share_crop", "faults_distance_km", "contact_distance_km"]
PARAMS = dict(n_estimators=200, learning_rate=0.03, max_depth=3, num_leaves=6, min_child_samples=15, subsample=0.8,
              subsample_freq=1, colsample_bytree=0.6, reg_lambda=5.0, verbose=-1, n_jobs=8)


def read_records(path: str | Path) -> pd.DataFrame:
    records = pd.read_csv(path)
    missing = [name for name in REQUIRED if name not in records.columns]
    if missing:
        raise SystemExit(f"Missing columns: {', '.join(missing)}. See field_records_template.csv.")
    outcome = records.outcome.astype(str).str.strip().str.lower()
    unknown = sorted(set(outcome) - {"water", "dry"})
    if unknown:
        raise SystemExit(f"outcome must be 'water' or 'dry'. Found: {', '.join(unknown[:5])}")
    records["water"] = (outcome == "water").astype(int)
    records["grade"] = records.get("grade", pd.Series("G2", index=records.index)).fillna("G2").astype(str).str.upper()
    records = records.dropna(subset=["latitude", "longitude"]).reset_index(drop=True)
    records["weight"] = records.grade.map(GRADE_WEIGHT).fillna(0.4)
    records["block"] = (np.floor(records.latitude / BLOCK_DEG).astype(int).astype(str) + "_" +
                        np.floor(records.longitude / BLOCK_DEG).astype(int).astype(str))
    return records


def gate_failures(records: pd.DataFrame) -> list[str]:
    failures = []
    dry = int((records.water == 0).sum())
    if len(records) < MIN_RECORDS:
        failures.append(f"needs {MIN_RECORDS} records, has {len(records)}")
    if dry < MIN_DRY_HOLES:
        failures.append(f"needs {MIN_DRY_HOLES} dry holes, has {dry}")
    if records.block.nunique() < MIN_BLOCKS:
        failures.append(f"needs records in {MIN_BLOCKS} areas, has {records.block.nunique()}")
    return failures


def attach_map(records: pd.DataFrame) -> pd.DataFrame:
    table = pd.read_csv(GW_MAP)
    site_files = [DATA_DIR / "features_grid" / f"{name}.csv" for name in ("dem", "gsi", "weathering", "climate", "modis", "surface")]
    sites = pd.read_csv(DATA_DIR / "gw_grid.csv")
    for path in site_files:
        sites = sites.merge(pd.read_csv(path).drop_duplicates("site"), on="site", how="left", suffixes=("", "_extra"))
    tree = BallTree(np.radians(table[["latitude", "longitude"]].to_numpy()), metric="haversine")
    distance, index = tree.query(np.radians(records[["latitude", "longitude"]].to_numpy()), k=1)
    inside = distance[:, 0] * 6371 <= MAX_MAP_DISTANCE_KM
    if (~inside).any():
        print(f"Skipping {int((~inside).sum())} records outside the groundwater map.")
    chosen = index[inside, 0]
    joined = records[inside].reset_index(drop=True)
    for name in MAP_FEATURES:
        joined[name] = table[name].to_numpy()[chosen]
    site_lookup = sites.merge(table[["latitude", "longitude"]], on=["latitude", "longitude"])
    for name in SITE_FEATURES:
        joined[name] = site_lookup[name].to_numpy()[chosen]
    return joined


def nearby_rate(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    """Distance-weighted share of nearby wells that found water: the simple baseline."""
    tree = BallTree(np.radians(train[["latitude", "longitude"]].to_numpy()), metric="haversine")
    distance, index = tree.query(np.radians(test[["latitude", "longitude"]].to_numpy()), k=min(8, len(train)))
    weights = 1 / np.maximum(distance * 6371, 0.3) ** 2
    return (weights * train.water.to_numpy()[index]).sum(axis=1) / weights.sum(axis=1)


def calibration_error(truth: np.ndarray, probability: np.ndarray) -> float:
    bins = np.clip((probability * 10).astype(int), 0, 9)
    return float(sum(abs(probability[bins == b].mean() - truth[bins == b].mean()) * (bins == b).mean() for b in range(10) if (bins == b).any()))


def cross_validate(records: pd.DataFrame, features: list[str]) -> tuple[dict, np.ndarray]:
    truth = records.water.to_numpy()
    groups = records.block.to_numpy()
    folds = min(5, len(set(groups)))
    raw, base, nearby = np.zeros(len(records)), np.zeros(len(records)), np.zeros(len(records))
    for train_index, test_index in GroupKFold(folds).split(records, groups=groups):
        train = records.iloc[train_index]
        model = lgb.LGBMClassifier(random_state=0, **PARAMS).fit(train[features], train.water, sample_weight=train.weight)
        raw[test_index] = model.predict_proba(records.iloc[test_index][features])[:, 1]
        base[test_index] = train.water.mean()
        nearby[test_index] = nearby_rate(train, records.iloc[test_index])
    calibrated = np.zeros(len(records))
    for train_index, test_index in KFold(5, shuffle=True, random_state=0).split(raw):
        calibrated[test_index] = IsotonicRegression(out_of_bounds="clip", y_min=0.02, y_max=0.98).fit(raw[train_index], truth[train_index]).predict(raw[test_index])
    predicted_water = calibrated >= 0.5
    return {
        "records": len(records),
        "waterShare": round(float(truth.mean()), 3),
        "brier": round(float(brier_score_loss(truth, calibrated)), 4),
        "brierBaseRate": round(float(brier_score_loss(truth, base)), 4),
        "brierNearbyWells": round(float(brier_score_loss(truth, np.clip(nearby, 0.02, 0.98))), 4),
        "calibrationError": round(calibration_error(truth, calibrated), 4),
        "rocAuc": round(float(roc_auc_score(truth, calibrated)), 3),
        "dryPrAuc": round(float(average_precision_score(1 - truth, 1 - calibrated)), 3),
        "dryRecall": round(float(recall_score(1 - truth, ~predicted_water, zero_division=0)), 3),
        "dryPrecision": round(float(precision_score(1 - truth, ~predicted_water, zero_division=0)), 3),
    }, raw


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python retrain_with_field_data.py field_records.csv")
    records = attach_map(read_records(sys.argv[1]))
    features = MAP_FEATURES + SITE_FEATURES
    report, raw = cross_validate(records, features)
    print(json.dumps(report, indent=1))

    failures = gate_failures(records)
    if report["brier"] >= min(report["brierBaseRate"], report["brierNearbyWells"]):
        failures.append("does not beat the simple baselines")
    if report["calibrationError"] > MAX_CALIBRATION_ERROR:
        failures.append(f"calibration error {report['calibrationError']} is above {MAX_CALIBRATION_ERROR}")
    if failures:
        print("NOT SAVED. Release gates failed: " + "; ".join(failures))
        return

    model = lgb.LGBMClassifier(random_state=0, **PARAMS).fit(records[features], records.water, sample_weight=records.weight)
    calibrator = IsotonicRegression(out_of_bounds="clip", y_min=0.02, y_max=0.98).fit(raw, records.water)
    joblib.dump({"model": model, "calibrator": calibrator, "features": features, "report": report}, OUTCOME_MODEL)
    print(f"Saved {OUTCOME_MODEL}. Run it as a silent pilot and have a hydrogeologist review it before farmers see it.")


if __name__ == "__main__":
    main()
