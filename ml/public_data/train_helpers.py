"""Train and honestly test helper models on public wells.

Helpers predict yield relative to the well's own state and decade, and depth to
bedrock. They are inputs for the future main model, not farmer-facing predictions:
the public wells hold almost no dry holes, so nothing here estimates drilling success.

Feature groups are added one at a time and kept only if they beat the current set
under spatial validation, with a block-bootstrap interval that excludes no change.
"""
from __future__ import annotations

import json
import warnings

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.model_selection import GroupKFold
from sklearn.neighbors import BallTree

from build_wells import inside_excluded_box
from config import FEATURE_DIR, GW_MODEL_DIR, MODEL_DIR, RESULTS, WELLS

warnings.filterwarnings("ignore")

SPLIT_REPEATS = 5
BOOTSTRAPS = 2000
NEIGHBOURS = 5
NEIGHBOUR_RADIUS_KM = 30
GROUP_ORDER = ["rock", "geology_gsi", "terrain", "fracture_proxy", "weathering", "soil", "water", "climate", "satellite",
               "surface", "surface_water", "groundwater_model", "neighbours"]
PARAMS = dict(n_estimators=250, learning_rate=0.03, max_depth=3, num_leaves=6, min_child_samples=25,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, verbose=-1, n_jobs=4)

GROUPS = {
    "rock": ["rock_gneiss", "rock_granite", "rock_charnockite", "rock_schist"],
    "geology_gsi": ["gsi_family_code", "gsi_unit_code", "gsi_age_rank", "faults_distance_km", "thrusts_distance_km", "contact_distance_km"],
    "satellite": ["ndvi_dry", "ndvi_wet", "ndvi_seasonal_drop", "lst_dry_k", "et_mm", "pet_mm", "aridity_et_pet"],
    "surface_water": ["jrc_occurrence_1km", "jrc_water_km"],
    "groundwater_model": ["gw_pre_m", "gw_post_m", "gw_rise_m", "gw_chance_10m"],
    "terrain": ["elevation_m", "slope", "relief_1km", "tpi_150m", "tpi_500m", "tpi_1500m", "tpi_3km", "twi",
                "log_upstream", "drain_distance_m", "hand_m", "drain_density"],
    "fracture_proxy": ["line_score", "line_distance_m", "line_density_1km", "line_density_3km", "line_coherence", "line_crossing"],
    "weathering": ["soilgrids_bedrock_cm", "soilgrids_r_horizon_cm"],
    "soil": ["clay_30cm", "sand_30cm"],
    "water": ["water_depth_pre_m", "water_depth_post_m", "water_seasonal_rise_m", "water_station_km"],
    "climate": ["rain_mean_mm", "rain_cv"],
    "surface": ["share_tree", "share_scrub", "share_crop", "share_built", "share_bare", "share_water", "water_distance_m"],
    "neighbours": ["near_mean", "near_distance_km", "near_count"],
}


def load() -> pd.DataFrame:
    frame = pd.read_csv(WELLS, dtype={"decade": str})
    assert not inside_excluded_box(frame).any(), "pilot-box readings must not reach training"
    for name in ["dem", "gsi", "weathering", "soil", "water", "climate", "modis", "jrc", "surface"]:
        path = FEATURE_DIR / f"{name}.csv"
        if path.exists():
            frame = frame.merge(pd.read_csv(path).drop_duplicates("site"), on="site", how="left")
    frame = attach_groundwater_model(frame)
    for rock in ["gneiss", "granite", "charnockite", "schist"]:
        frame[f"rock_{rock}"] = (frame.rock == rock).astype(float)
    return frame


def attach_groundwater_model(frame: pd.DataFrame) -> pd.DataFrame:
    """Add the trained groundwater model's view of each well site, so this test also
    answers whether water-table conditions say anything about yield."""
    import train_groundwater as tg
    package = joblib.load(GW_MODEL_DIR / "groundwater_model.joblib")
    categories = package["categories"]
    frame["gsi_family_code"] = frame.gsi_family.map(categories["family"]).astype(float)
    frame["gsi_unit_code"] = frame.gsi_unit.map(categories["unit"]).fillna(categories["unit"].get("rare", -1)).astype(float)
    frame["key"] = "well"
    frame["block"] = frame.block.astype(str)
    stations = package["stations"]
    for target, entry in package["models"].items():
        evidence = pd.concat([tg.local_evidence(stations, frame, target, False), tg.history_evidence(frame, target, set(), set())], axis=1)
        prediction = entry["model"].predict(pd.concat([frame, evidence], axis=1)[entry["features"]])
        frame[f"gw_{target}"] = np.expm1(prediction) if entry["kind"] == "log" else prediction
    shallow = package["shallow"]
    evidence = pd.concat([tg.local_evidence(stations, frame, "pre_m", False), tg.history_evidence(frame, "pre_m", set(), set())], axis=1)
    frame["gw_chance_10m"] = shallow["calibrator"].predict(shallow["model"].predict_proba(pd.concat([frame, evidence], axis=1)[shallow["features"]])[:, 1])
    return frame


def neighbour_features(train: pd.DataFrame, test: pd.DataFrame, target: str) -> pd.DataFrame:
    """Distance-weighted target of other sites. Uses training rows only, so a well's
    own answer and its test-fold neighbours never leak in."""
    tree = BallTree(np.radians(train[["latitude", "longitude"]].to_numpy()), metric="haversine")
    distance, index = tree.query(np.radians(test[["latitude", "longitude"]].to_numpy()), k=min(NEIGHBOURS + 40, len(train)))
    values = train[target].to_numpy()
    sites = train.site.to_numpy()
    rows = []
    for position, site in enumerate(test.site.to_numpy()):
        km = distance[position] * 6371
        keep = (km <= NEIGHBOUR_RADIUS_KM) & (sites[index[position]] != site)
        km_kept, found = km[keep][:NEIGHBOURS], values[index[position]][keep][:NEIGHBOURS]
        if not len(found):
            rows.append((np.nan, np.nan, 0.0))
            continue
        weights = 1 / np.maximum(km_kept, 0.5)
        rows.append((float((found * weights).sum() / weights.sum()), float(km_kept[0]), float(len(found))))
    return pd.DataFrame(rows, columns=GROUPS["neighbours"], index=test.index)


def fold_matrix(frame: pd.DataFrame, features: list[str], target: str, train_index, test_index):
    train, test = frame.iloc[train_index], frame.iloc[test_index]
    plain = [name for name in features if name not in GROUPS["neighbours"]]
    x_train, x_test = train[plain].copy(), test[plain].copy()
    if any(name in features for name in GROUPS["neighbours"]):
        # Training rows need neighbours computed the same way: other training sites only.
        x_train = pd.concat([x_train, neighbour_features(train, train, target)], axis=1)
        x_test = pd.concat([x_test, neighbour_features(train, test, target)], axis=1)
    return x_train, x_test, train[target].to_numpy()


def splits(frame: pd.DataFrame, repeat: int):
    """0.5 degree blocks, shuffled into folds differently on each repeat. Same-site
    wells share a block, so they can't straddle train and test."""
    blocks = frame.block.to_numpy()
    unique = np.unique(blocks)
    mapping = dict(zip(np.random.default_rng(repeat).permutation(unique), np.arange(len(unique))))
    return list(GroupKFold(5).split(frame, groups=[mapping[block] for block in blocks]))


def cross_predict(frame: pd.DataFrame, features: list[str], target: str) -> np.ndarray:
    """Mean out-of-fold prediction across repeats. Each fold's training-set mean is the
    no-model baseline when there are no features."""
    total = np.zeros(len(frame))
    for repeat in range(SPLIT_REPEATS):
        for train_index, test_index in splits(frame, repeat):
            if not features:
                total[test_index] += frame.iloc[train_index][target].mean()
                continue
            x_train, x_test, y_train = fold_matrix(frame, features, target, train_index, test_index)
            model = lgb.LGBMRegressor(random_state=repeat, **PARAMS).fit(x_train, y_train)
            total[test_index] += model.predict(x_test)
    return total / SPLIT_REPEATS


def block_bootstrap(frame: pd.DataFrame, error_a: np.ndarray, error_b: np.ndarray) -> dict:
    """Interval for the reduction in squared error of b over a, resampling whole blocks."""
    keys, inverse = np.unique(frame.block.to_numpy(), return_inverse=True)
    sum_a = np.bincount(inverse, error_a, len(keys))
    sum_b = np.bincount(inverse, error_b, len(keys))
    counts = np.bincount(inverse, minlength=len(keys))
    rng = np.random.default_rng(0)
    draws = rng.integers(0, len(keys), (BOOTSTRAPS, len(keys)))
    delta = (sum_a[draws].sum(1) - sum_b[draws].sum(1)) / counts[draws].sum(1)
    return {"improvement": float((error_a - error_b).mean()),
            "low": float(np.percentile(delta, 2.5)), "high": float(np.percentile(delta, 97.5))}


def metrics(frame: pd.DataFrame, target: str, prediction: np.ndarray, baseline: np.ndarray) -> dict:
    truth = frame[target].to_numpy()
    mse, base_mse = ((truth - prediction) ** 2), ((truth - baseline) ** 2)
    result = {"rows": len(frame), "r2": float(1 - mse.mean() / base_mse.mean()), "rmse": float(np.sqrt(mse.mean())),
              "baselineRmse": float(np.sqrt(base_mse.mean())), "spearman": float(spearmanr(truth, prediction).statistic)}
    result["againstBaseline"] = block_bootstrap(frame, base_mse, mse)
    return result


def tamil_nadu_transfer(frame: pd.DataFrame, features: list[str], target: str) -> dict:
    """Train without Tamil Nadu, then score Tamil Nadu: the regional shift a model faces."""
    train_index = np.flatnonzero(frame.state != "TN")
    test_index = np.flatnonzero(frame.state == "TN")
    if not features or not len(test_index):
        return {}
    x_train, x_test, y_train = fold_matrix(frame, features, target, train_index, test_index)
    prediction = lgb.LGBMRegressor(random_state=0, **PARAMS).fit(x_train, y_train).predict(x_test)
    test = frame.iloc[test_index]
    return metrics(test, target, prediction, np.full(len(test), y_train.mean()))


def run_target(frame: pd.DataFrame, target: str, skip: set[str]) -> dict:
    data = frame[frame[target].notna()].reset_index(drop=True)
    baseline = cross_predict(data, [], target)
    selected: list[str] = []
    kept: list[str] = []
    current = baseline
    current_error = (data[target].to_numpy() - current) ** 2
    trials = []
    for group in GROUP_ORDER:
        columns = [name for name in GROUPS[group] if name in data.columns or group == "neighbours"]
        if group in skip or not columns:
            continue
        candidate = cross_predict(data, selected + columns, target)
        error = (data[target].to_numpy() - candidate) ** 2
        test = block_bootstrap(data, current_error, error)
        earned = test["low"] > 0
        trials.append({"group": group, **test, "kept": earned})
        print(target, group, {k: round(v, 4) if isinstance(v, float) else v for k, v in trials[-1].items()}, flush=True)
        if earned:
            selected += columns
            kept.append(group)
            current, current_error = candidate, error

    allgroups = [name for group in GROUP_ORDER if group not in skip for name in GROUPS[group]
                 if name in data.columns or group == "neighbours"]
    everything = cross_predict(data, allgroups, target)

    # Null check: on shuffled targets the same process must find nothing.
    rng = np.random.default_rng(1)
    shuffled = data.copy()
    shuffled[target] = rng.permutation(shuffled[target].to_numpy())
    null_features = allgroups
    null_prediction = cross_predict(shuffled, null_features, target)
    null_r2 = 1 - ((shuffled[target] - null_prediction) ** 2).mean() / ((shuffled[target] - cross_predict(shuffled, [], target)) ** 2).mean()

    final = selected or allgroups
    report = {
        "target": target,
        "groupTrials": trials,
        "keptGroups": kept,
        "selectedModel": metrics(data, target, current, baseline) if kept else None,
        "allGroupsModel": metrics(data, target, everything, baseline),
        "shuffledTargetR2": float(null_r2),
        "tamilNaduTransfer": tamil_nadu_transfer(data, final, target),
    }
    tn = data.state == "TN"
    report["tamilNaduInSpatialCv"] = metrics(data[tn], target, (current if kept else everything)[tn], baseline[tn])

    if kept:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        full = data[[name for name in selected if name not in GROUPS["neighbours"]]].copy()
        if any(name in selected for name in GROUPS["neighbours"]):
            full = pd.concat([full, neighbour_features(data, data, target)], axis=1)
        model = lgb.LGBMRegressor(random_state=0, **PARAMS).fit(full, data[target])
        joblib.dump({"model": model, "features": list(full.columns), "target": target}, MODEL_DIR / f"{target}.joblib")
        report["importance"] = dict(sorted(zip(full.columns, map(int, model.feature_importances_)), key=lambda item: -item[1])[:12])
    return report


def main() -> None:
    frame = load()
    print("wells", len(frame), "columns", frame.shape[1], flush=True)
    frame["log_bedrock"] = np.log10(frame.bedrock_m)
    results = {
        "note": "Public wells only. Pilot-box readings excluded. Not a drilling-success model.",
        "excludedBox": True,
        # A bedrock helper must not use SoilGrids-free shortcuts from the same log, and
        # neighbours are valid for both targets because they use other sites only.
        "yieldAnomaly": run_target(frame, "yield_anomaly", set()),
        "logBedrock": run_target(frame, "log_bedrock", set()),
    }
    RESULTS.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=1)[:3000])


if __name__ == "__main__":
    main()
