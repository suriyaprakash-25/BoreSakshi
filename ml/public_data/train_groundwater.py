"""Train the groundwater model on measured water levels.

Predicts how deep the water table is before and after the monsoon, how far it rises,
and the chance it is within usable shallow depth. No drilling outcomes are used, so it
describes groundwater in the shallow aquifer. It does not promise a borewell result.

Three honest tests, because each answers a different question:
  region   hold out 0.5 degree blocks: an area with no monitoring data nearby
  station  hold out single stations: a place with monitored wells around it
  newer    train on older stations, test on stations first read from 2016
"""
from __future__ import annotations

import json
import warnings

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import accuracy_score, average_precision_score, brier_score_loss, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GroupKFold, KFold
from sklearn.neighbors import BallTree

from config import EXCLUDED_BOX, FEATURE_DIR, GW_DUG_WELLS, GW_EVIDENCE, GW_MODEL_DIR, GW_RESULTS, GW_STATIONS

warnings.filterwarnings("ignore")

TARGETS = {"pre_m": "log", "post_m": "log", "rise_m": "raw"}
SHALLOW_M = 10.0
DEPTH_CLASSES = [0, 2, 5, 10, 20, 40, 1000]  # CGWB's depth-to-water bands, in metres
NEIGHBOURS = 8
RADIUS_KM = 60
REPEATS = 2
BOOTSTRAPS = 1000
INTERVAL = 0.8
PARAMS = dict(n_estimators=450, learning_rate=0.03, num_leaves=24, max_depth=7, min_child_samples=15, subsample=0.8,
              subsample_freq=1, colsample_bytree=0.6, reg_lambda=3.0, verbose=-1, n_jobs=8)

GROUPS = {
    "terrain": ["elevation_m", "slope", "relief_1km", "tpi_150m", "tpi_500m", "tpi_1500m", "tpi_3km", "twi",
                "log_upstream", "drain_distance_m", "hand_m", "drain_density"],
    "fracture_proxy": ["line_score", "line_distance_m", "line_density_1km", "line_density_3km", "line_coherence", "line_crossing"],
    "geology_gsi": ["gsi_family_code", "gsi_unit_code", "gsi_age_rank", "faults_distance_km", "thrusts_distance_km", "contact_distance_km"],
    "weathering": ["soilgrids_bedrock_cm", "soilgrids_r_horizon_cm"],
    "soil": ["clay_30cm", "sand_30cm"],
    "climate": ["rain_mean_mm", "rain_cv"],
    "satellite": ["ndvi_dry", "ndvi_wet", "ndvi_seasonal_drop", "lst_dry_k", "et_mm", "pet_mm", "aridity_et_pet"],
    "surface_water": ["jrc_occurrence_1km", "jrc_water_km", "water_distance_m", "share_water"],
    "land_cover": ["share_tree", "share_scrub", "share_crop", "share_built", "share_bare"],
}
LOCAL = ["near_value", "near_head_depth", "near_km", "near_count", "near_spread",
         "history_value", "history_km", "history_count", "dug_depth", "dug_km", "dug_count"]
SELF_KM = 0.1
HISTORY_RADIUS_KM = 30
EVIDENCE_COLUMN = {"pre_m": "pre_all_m", "post_m": "post_all_m"}
CATEGORICAL = ["gsi_family_code", "gsi_unit_code"]


def block_of(frame: pd.DataFrame) -> np.ndarray:
    return (np.floor(frame.latitude / 0.5).astype(int).astype(str) + "_" + np.floor(frame.longitude / 0.5).astype(int).astype(str)).to_numpy()


def evidence_tables() -> tuple[pd.DataFrame, pd.DataFrame]:
    levels, dug = pd.read_csv(GW_EVIDENCE), pd.read_csv(GW_DUG_WELLS)
    levels["rise_all_m"] = levels.pre_all_m - levels.post_all_m
    levels["block"], dug["block"] = block_of(levels), block_of(dug)
    levels["key"] = levels.latitude.astype(str) + "," + levels.longitude.astype(str)
    return levels, dug


LEVELS, DUG = None, None
EVIDENCE_CACHE: dict = {}


def idw(table: pd.DataFrame, values: np.ndarray, query: pd.DataFrame, radius_km: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Inverse-distance average of the nearest records, skipping anything at the query
    point itself so a station never reads its own history."""
    tree = BallTree(np.radians(table[["latitude", "longitude"]].to_numpy()), metric="haversine")
    distance, index = tree.query(np.radians(query[["latitude", "longitude"]].to_numpy()), k=min(NEIGHBOURS + 2, len(table)))
    km = distance * 6371
    weights = np.where((km > SELF_KM) & (km <= radius_km), 1 / np.maximum(km, 0.3) ** 2, 0.0)
    total = weights.sum(axis=1)
    mean = np.where(total > 0, (weights * values[index]).sum(axis=1) / np.where(total > 0, total, 1), np.nan)
    nearest = np.where(weights > 0, km, np.inf).min(axis=1)
    return mean, np.where(np.isinf(nearest), np.nan, nearest), (weights > 0).sum(axis=1)


def history_evidence(query: pd.DataFrame, target: str, hidden_blocks: set, hidden_keys: set) -> pd.DataFrame:
    """Long-term levels and dug-well depths around each site. Anything inside a held-out
    block, or belonging to a held-out station, is hidden so tests stay honest."""
    global LEVELS, DUG
    if LEVELS is None:
        LEVELS, DUG = evidence_tables()
    column = EVIDENCE_COLUMN.get(target, "rise_all_m")
    levels = LEVELS[LEVELS[column].notna() & ~LEVELS.block.isin(hidden_blocks) & ~LEVELS.key.isin(hidden_keys)]
    dug = DUG[~DUG.block.isin(hidden_blocks)]
    history_value, history_km, history_count = idw(levels, levels[column].to_numpy(), query, HISTORY_RADIUS_KM)
    dug_depth, dug_km, dug_count = idw(dug, dug.well_depth_m.to_numpy(), query, HISTORY_RADIUS_KM)
    return pd.DataFrame({"history_value": history_value, "history_km": history_km, "history_count": history_count,
                         "dug_depth": dug_depth, "dug_km": dug_km, "dug_count": dug_count}, index=query.index)


def load() -> pd.DataFrame:
    frame = pd.read_csv(GW_STATIONS)
    for name in ["dem", "gsi", "weathering", "soil", "climate", "modis", "jrc", "surface"]:
        path = FEATURE_DIR / f"{name}.csv"
        if path.exists():
            frame = frame.merge(pd.read_csv(path).drop_duplicates("site"), on="site", how="left")
    frame = frame[frame.elevation_m.notna()].reset_index(drop=True)
    frame["gsi_family_code"] = frame.gsi_family.astype("category").cat.codes
    counts = frame.gsi_unit.value_counts()
    frame["gsi_unit_code"] = frame.gsi_unit.where(frame.gsi_unit.map(counts) >= 20, "rare").astype("category").cat.codes
    frame["block"] = block_of(frame)
    frame["key"] = frame.latitude.astype(str) + "," + frame.longitude.astype(str)
    frame["pre_head"] = frame.elevation_m - frame.pre_m
    frame["post_head"] = frame.elevation_m - frame.post_m
    return frame


def local_evidence(train: pd.DataFrame, query: pd.DataFrame, target: str, same_rows: bool) -> pd.DataFrame:
    """Readings at nearby training stations. The water table follows the land loosely,
    so besides averaging neighbours' depth it also carries their water-surface level
    across and subtracts it from this site's elevation."""
    tree = BallTree(np.radians(train[["latitude", "longitude"]].to_numpy()), metric="haversine")
    count = min(NEIGHBOURS + (1 if same_rows else 0), len(train))
    distance, index = tree.query(np.radians(query[["latitude", "longitude"]].to_numpy()), k=count)
    if same_rows:  # a station must not see its own reading
        distance, index = distance[:, 1:], index[:, 1:]
    km = distance * 6371
    weights = np.where(km <= RADIUS_KM, 1 / np.maximum(km, 0.3) ** 2, 0.0)
    total = weights.sum(axis=1)
    usable = total > 0
    values = train[target].to_numpy()[index]
    mean = np.where(usable, (weights * values).sum(axis=1) / np.where(usable, total, 1), np.nan)
    spread = np.sqrt(np.where(usable, (weights * (values - mean[:, None]) ** 2).sum(axis=1) / np.where(usable, total, 1), np.nan))
    result = pd.DataFrame({"near_value": mean, "near_km": km[:, 0], "near_count": (km <= RADIUS_KM).sum(axis=1), "near_spread": spread}, index=query.index)
    head_target = {"pre_m": "pre_head", "post_m": "post_head"}.get(target)
    if head_target:
        heads = train[head_target].to_numpy()[index]
        head = np.where(usable, (weights * heads).sum(axis=1) / np.where(usable, total, 1), np.nan)
        result["near_head_depth"] = query.elevation_m.to_numpy() - head
    else:
        result["near_head_depth"] = np.nan
    return result


def transform(values: np.ndarray, target: str) -> np.ndarray:
    return np.log1p(values) if TARGETS[target] == "log" else values


def restore(values: np.ndarray, target: str) -> np.ndarray:
    return np.expm1(values) if TARGETS[target] == "log" else values


def matrices(frame: pd.DataFrame, features: list[str], target: str, train_index, test_index):
    train, test = frame.iloc[train_index], frame.iloc[test_index]
    plain = [name for name in features if name not in LOCAL]
    x_train, x_test = train[plain].copy(), test[plain].copy()
    if any(name in LOCAL for name in features):
        key = (target, len(frame), np.asarray(test_index).tobytes())
        if key not in EVIDENCE_CACHE:
            # A region hold-out hides whole blocks; a station hold-out hides just those stations.
            hidden_blocks = set(test.block) - set(train.block)
            hidden_keys = set(test.key)
            EVIDENCE_CACHE[key] = (
                pd.concat([local_evidence(train, train, target, True), history_evidence(train, target, hidden_blocks, hidden_keys)], axis=1),
                pd.concat([local_evidence(train, test, target, False), history_evidence(test, target, hidden_blocks, hidden_keys)], axis=1),
            )
        evidence_train, evidence_test = EVIDENCE_CACHE[key]
        x_train = pd.concat([x_train, evidence_train], axis=1)
        x_test = pd.concat([x_test, evidence_test], axis=1)
    return x_train, x_test


def fit(x, y, seed=0, **overrides):
    categorical = [name for name in CATEGORICAL if name in x.columns]
    return lgb.LGBMRegressor(random_state=seed, **{**PARAMS, **overrides}).fit(x, y, categorical_feature=categorical or "auto")


def region_splits(frame: pd.DataFrame, repeat: int):
    blocks = frame.block.to_numpy()
    unique = np.unique(blocks)
    mapping = dict(zip(np.random.default_rng(repeat).permutation(unique), range(len(unique))))
    return list(GroupKFold(5).split(frame, groups=[mapping[item] for item in blocks]))


def station_splits(frame: pd.DataFrame, repeat: int):
    return list(KFold(5, shuffle=True, random_state=repeat).split(frame))


def cross_predict(frame: pd.DataFrame, features: list[str], target: str, split, repeats: int = REPEATS, column: str = "") -> np.ndarray:
    """Out-of-fold prediction in the target's own units. With no features it returns
    the training mean, the no-model baseline. column='near_value' scores neighbours alone."""
    truth = transform(frame[target].to_numpy(), target)
    total = np.zeros(len(frame))
    for repeat in range(repeats):
        for train_index, test_index in split(frame, repeat):
            if column:
                evidence = local_evidence(frame.iloc[train_index], frame.iloc[test_index], target, False)[column]
                total[test_index] += transform(evidence.fillna(frame.iloc[train_index][target].mean()).to_numpy(), target)
            elif not features:
                total[test_index] += truth[train_index].mean()
            else:
                x_train, x_test = matrices(frame, features, target, train_index, test_index)
                total[test_index] += fit(x_train, truth[train_index], repeat).predict(x_test)
    return total / repeats


def bootstrap_gain(frame: pd.DataFrame, error_a: np.ndarray, error_b: np.ndarray) -> dict:
    keys, inverse = np.unique(frame.block.to_numpy(), return_inverse=True)
    sum_a, sum_b = np.bincount(inverse, error_a, len(keys)), np.bincount(inverse, error_b, len(keys))
    counts = np.bincount(inverse, minlength=len(keys))
    draws = np.random.default_rng(0).integers(0, len(keys), (BOOTSTRAPS, len(keys)))
    delta = (sum_a[draws].sum(1) - sum_b[draws].sum(1)) / counts[draws].sum(1)
    return {"gain": float((error_a - error_b).mean()), "low": float(np.percentile(delta, 2.5)), "high": float(np.percentile(delta, 97.5))}


def score(truth_m: np.ndarray, predicted_m: np.ndarray, target: str) -> dict:
    error = predicted_m - truth_m
    base = truth_m - truth_m.mean()
    result = {"stations": int(len(truth_m)), "maeM": round(float(np.abs(error).mean()), 2), "medianErrorM": round(float(np.median(np.abs(error))), 2),
              "rmseM": round(float(np.sqrt((error ** 2).mean())), 2), "r2": round(float(1 - (error ** 2).mean() / (base ** 2).mean()), 3),
              "within2mPct": round(float((np.abs(error) <= 2).mean() * 100), 1)}
    if TARGETS[target] == "log":
        result["depthBandAccuracyPct"] = round(float((np.digitize(truth_m, DEPTH_CLASSES) == np.digitize(predicted_m, DEPTH_CLASSES)).mean() * 100), 1)
        log_error = np.log1p(predicted_m) - np.log1p(truth_m)
        result["r2Log"] = round(float(1 - (log_error ** 2).mean() / ((np.log1p(truth_m) - np.log1p(truth_m).mean()) ** 2).mean()), 3)
    return result


def compare(frame: pd.DataFrame, target: str, features: list[str], split, label: str) -> dict:
    truth = frame[target].to_numpy()
    mean_only = restore(cross_predict(frame, [], target, split), target)
    neighbours = restore(cross_predict(frame, [], target, split, column="near_value"), target)
    model = restore(cross_predict(frame, features, target, split), target)
    report = {"meanOnly": score(truth, mean_only, target), "nearbyAverageOnly": score(truth, neighbours, target), "model": score(truth, model, target)}
    report["modelBeatsNearbyAverage"] = bootstrap_gain(frame, (truth - neighbours) ** 2, (truth - model) ** 2)
    print(target, label, json.dumps({k: v for k, v in report["model"].items()}), "nearby", report["nearbyAverageOnly"]["maeM"], flush=True)
    return report, model


def select_groups(frame: pd.DataFrame, target: str) -> tuple[list[str], list[dict]]:
    """Start from local evidence, then add map groups one at a time, keeping a group only
    if it clearly helps. The station test is used because the pilot area has monitored
    wells around it; the region test stays as a stress test for areas without them."""
    truth = transform(frame[target].to_numpy(), target)
    selected = list(LOCAL)
    current = (truth - cross_predict(frame, selected, target, station_splits)) ** 2
    trials = []
    for group, columns in GROUPS.items():
        available = [name for name in columns if name in frame.columns]
        if not available:
            continue
        error = (truth - cross_predict(frame, selected + available, target, station_splits)) ** 2
        gain = bootstrap_gain(frame, current, error)
        kept = gain["low"] > 0
        trials.append({"group": group, **gain, "kept": kept})
        print(target, "group", group, {k: round(v, 5) if isinstance(v, float) else v for k, v in gain.items()}, kept, flush=True)
        if kept:
            selected += available
            current = error
    return selected, trials


def shallow_classifier(frame: pd.DataFrame, features: list[str], split, label: str) -> tuple[dict, np.ndarray]:
    """Chance that the pre-monsoon water table is within SHALLOW_M: the driest time of
    year, when it matters. Probabilities are calibrated on out-of-fold predictions."""
    positive = (frame.pre_m <= SHALLOW_M).astype(int).to_numpy()
    probability = np.zeros(len(frame))
    for train_index, test_index in split(frame, 0):
        x_train, x_test = matrices(frame, features, "pre_m", train_index, test_index)
        categorical = [name for name in CATEGORICAL if name in x_train.columns]
        model = lgb.LGBMClassifier(random_state=0, **PARAMS).fit(x_train, positive[train_index], categorical_feature=categorical or "auto")
        probability[test_index] = model.predict_proba(x_test)[:, 1]
    calibrated = np.zeros(len(frame))
    for train_index, test_index in KFold(5, shuffle=True, random_state=1).split(probability):
        calibrated[test_index] = IsotonicRegression(out_of_bounds="clip", y_min=0.01, y_max=0.99).fit(probability[train_index], positive[train_index]).predict(probability[test_index])
    call = calibrated >= 0.5
    bins = np.clip((calibrated * 10).astype(int), 0, 9)
    ece = sum(abs(calibrated[bins == b].mean() - positive[bins == b].mean()) * (bins == b).mean() for b in range(10) if (bins == b).any())
    # Warning farmers about deep water matters more than the plain 50% call.
    deep_alert = {}
    for cut in (0.6, 0.7, 0.8):
        flagged = calibrated < cut
        deep_alert[str(cut)] = {
            "flaggedPct": round(float(flagged.mean() * 100), 1),
            "precisionDeep": round(float(precision_score(1 - positive, flagged)), 3),
            "recallDeep": round(float(recall_score(1 - positive, flagged)), 3),
        }
    report = {
        "deepWarningAtShallowProbabilityBelow": deep_alert,
        "shallowShare": round(float(positive.mean()), 3),
        "alwaysYesAccuracy": round(float(max(positive.mean(), 1 - positive.mean())), 3),
        "accuracy": round(float(accuracy_score(positive, call)), 3),
        "precisionShallow": round(float(precision_score(positive, call)), 3),
        "recallShallow": round(float(recall_score(positive, call)), 3),
        "precisionDeep": round(float(precision_score(1 - positive, ~call)), 3),
        "recallDeep": round(float(recall_score(1 - positive, ~call)), 3),
        "rocAuc": round(float(roc_auc_score(positive, calibrated)), 3),
        "prAucDeep": round(float(average_precision_score(1 - positive, 1 - calibrated)), 3),
        "brier": round(float(brier_score_loss(positive, calibrated)), 4),
        "calibrationError": round(float(ece), 4),
    }
    print("shallow", label, report, flush=True)
    return report, calibrated


def regional_scores(frame: pd.DataFrame, target: str, predicted: np.ndarray) -> dict:
    truth = frame[target].to_numpy()
    south, west, north, east = EXCLUDED_BOX
    masks = {
        "tamilNaduBox": frame.latitude.between(8, 13.6) & frame.longitude.between(76.2, 80.4),
        "pilotArea": frame.latitude.between(south, north) & frame.longitude.between(west, east),
        "hardRock": frame.gsi_family.isin(["gneiss", "granite", "charnockite", "schist"]),
    }
    return {name: score(truth[mask], predicted[mask], target) for name, mask in masks.items() if mask.sum() >= 20}


def newer_station_test(frame: pd.DataFrame, target: str, features: list[str]) -> dict:
    test_mask = frame.first_year >= 2016
    train_index, test_index = np.flatnonzero(~test_mask), np.flatnonzero(test_mask)
    truth = transform(frame[target].to_numpy(), target)
    x_train, x_test = matrices(frame, features, target, train_index, test_index)
    predicted = restore(fit(x_train, truth[train_index]).predict(x_test), target)
    return score(frame[target].to_numpy()[test_index], predicted, target)


def interval_width(frame: pd.DataFrame, target: str, predicted: np.ndarray) -> dict:
    """Split-conformal half width in the model's scale, from out-of-fold residuals.
    Half the stations calibrate; the other half check the coverage."""
    truth, centre = transform(frame[target].to_numpy(), target), transform(predicted, target)
    residual = np.abs(truth - centre)
    order = np.random.default_rng(0).permutation(len(frame))
    half = len(order) // 2
    width = float(np.quantile(residual[order[:half]], INTERVAL))
    return {"halfWidth": round(width, 4), "coveragePct": round(float((residual[order[half:]] <= width).mean() * 100), 1), "targetPct": INTERVAL * 100}


def main() -> None:
    frame = load()
    print("stations", len(frame), "features", frame.shape[1], flush=True)
    results: dict = {"stations": len(frame), "targets": {}, "note": "Shallow unconfined aquifer levels. No drilling outcomes used."}
    final_features: dict = {}
    GW_MODEL_DIR.mkdir(parents=True, exist_ok=True)

    for target in TARGETS:
        selected, trials = select_groups(frame, target)
        final_features[target] = selected
        region, region_prediction = compare(frame, target, selected, region_splits, "region")
        station, station_prediction = compare(frame, target, selected, station_splits, "station")
        results["targets"][target] = {
            "groupTrials": trials,
            "keptGroups": [trial["group"] for trial in trials if trial["kept"]],
            "regionTest": region,
            "stationTest": station,
            "regionalStationTest": regional_scores(frame, target, station_prediction),
            "regionalRegionTest": regional_scores(frame, target, region_prediction),
            "newerStationTest": newer_station_test(frame, target, selected),
            "interval": interval_width(frame, target, station_prediction),
        }
        # Saved model uses every station; local evidence comes from all of them.
        full = pd.concat([frame[[name for name in selected if name not in LOCAL]], local_evidence(frame, frame, target, True),
                          history_evidence(frame, target, set(), set())], axis=1)
        model = fit(full, transform(frame[target].to_numpy(), target))
        importance = dict(sorted(zip(full.columns, map(int, model.booster_.feature_importance("gain"))), key=lambda item: -item[1])[:12])
        results["targets"][target]["topFeatures"] = importance
        joblib.dump({"model": model, "features": list(full.columns), "target": target, "kind": TARGETS[target],
                     "intervalHalfWidth": results["targets"][target]["interval"]["halfWidth"]}, GW_MODEL_DIR / f"{target}.joblib")
        GW_RESULTS.write_text(json.dumps(results, indent=2), encoding="utf-8")

    features = final_features["pre_m"]
    results["shallowWithin10m"] = {
        "regionTest": shallow_classifier(frame, features, region_splits, "region")[0],
        "stationTest": shallow_classifier(frame, features, station_splits, "station")[0],
    }
    GW_RESULTS.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print("saved", GW_RESULTS, flush=True)


if __name__ == "__main__":
    main()
