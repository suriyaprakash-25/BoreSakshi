"""Fit the final groundwater models on every station and save them for prediction."""
from __future__ import annotations

import json

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

import train_groundwater as tg
from config import GW_MODEL_DIR, GW_RESULTS


def evidence(frame: pd.DataFrame, target: str) -> pd.DataFrame:
    return pd.concat([tg.local_evidence(frame, frame, target, True), tg.history_evidence(frame, target, set(), set())], axis=1)


def category_maps(frame: pd.DataFrame) -> dict:
    counts = frame.gsi_unit.value_counts()
    units = frame.gsi_unit.where(frame.gsi_unit.map(counts) >= 20, "rare").astype("category")
    return {"family": {name: code for code, name in enumerate(frame.gsi_family.astype("category").cat.categories)},
            "unit": {name: code for code, name in enumerate(units.cat.categories)}}


def main() -> None:
    frame = tg.load()
    results = json.loads(GW_RESULTS.read_text(encoding="utf-8"))
    GW_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    package: dict = {"categories": category_maps(frame), "models": {}}

    for target in tg.TARGETS:
        kept = results["targets"][target]["keptGroups"]
        plain = [name for group in kept for name in tg.GROUPS[group]]
        full = pd.concat([frame[plain], evidence(frame, target)], axis=1)
        model = tg.fit(full, tg.transform(frame[target].to_numpy(), target))
        package["models"][target] = {"model": model, "features": list(full.columns), "kind": tg.TARGETS[target],
                                     "halfWidth": results["targets"][target]["interval"]["halfWidth"]}
        print("fitted", target, full.shape, flush=True)

    kept = results["targets"]["pre_m"]["keptGroups"]
    features = tg.LOCAL + [name for group in kept for name in tg.GROUPS[group]]
    positive = (frame.pre_m <= tg.SHALLOW_M).astype(int).to_numpy()
    out_of_fold = np.zeros(len(frame))
    for train_index, test_index in tg.station_splits(frame, 0):
        x_train, x_test = tg.matrices(frame, features, "pre_m", train_index, test_index)
        categorical = [name for name in tg.CATEGORICAL if name in x_train.columns]
        out_of_fold[test_index] = lgb.LGBMClassifier(random_state=0, **tg.PARAMS).fit(
            x_train, positive[train_index], categorical_feature=categorical or "auto").predict_proba(x_test)[:, 1]
    calibrator = IsotonicRegression(out_of_bounds="clip", y_min=0.01, y_max=0.99).fit(out_of_fold, positive)
    full = pd.concat([frame[[name for name in features if name not in tg.LOCAL]], evidence(frame, "pre_m")], axis=1)
    categorical = [name for name in tg.CATEGORICAL if name in full.columns]
    classifier = lgb.LGBMClassifier(random_state=0, **tg.PARAMS).fit(full, positive, categorical_feature=categorical or "auto")
    package["shallow"] = {"model": classifier, "calibrator": calibrator, "features": list(full.columns), "thresholdM": tg.SHALLOW_M}

    # Stations are kept so a prediction anywhere can use the same local evidence.
    package["stations"] = frame[["latitude", "longitude", "pre_m", "post_m", "rise_m", "pre_head", "post_head"]].copy()
    joblib.dump(package, GW_MODEL_DIR / "groundwater_model.joblib")
    print("saved", GW_MODEL_DIR / "groundwater_model.joblib")


if __name__ == "__main__":
    main()
