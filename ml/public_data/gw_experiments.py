"""One-off comparison of model settings for the groundwater targets.

Each option uses the same station hold-out folds, so differences are comparable.
Several options are compared on one dataset, so the winner's score is slightly
optimistic; the final model is re-scored separately.
"""
from __future__ import annotations

import json
import warnings

import lightgbm as lgb
import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.model_selection import KFold
from sklearn.neighbors import BallTree
from sklearn.pipeline import make_pipeline

import train_groundwater as tg
from config import DATA_DIR

warnings.filterwarnings("ignore")

TARGET = "pre_m"
LGB_BASE = dict(tg.PARAMS)
OPTIONS = {
    "current": {},
    "more_trees_slow": dict(n_estimators=1200, learning_rate=0.012),
    "small_leaves": dict(n_estimators=900, learning_rate=0.015, num_leaves=12, max_depth=5, min_child_samples=30, colsample_bytree=0.5),
    "regularised": dict(n_estimators=900, learning_rate=0.015, num_leaves=16, max_depth=6, min_child_samples=40, reg_lambda=10, colsample_bytree=0.4),
    "median_objective": dict(objective="l1", n_estimators=900, learning_rate=0.02, num_leaves=16, max_depth=6, min_child_samples=30, colsample_bytree=0.5),
    "huber_objective": dict(objective="huber", alpha=0.6, n_estimators=900, learning_rate=0.02, num_leaves=16, max_depth=6, min_child_samples=30, colsample_bytree=0.5),
}


def folds(frame):
    return list(KFold(5, shuffle=True, random_state=11).split(frame))


def residual_idw(train, residual, test, power=2, radius=30, k=8):
    tree = BallTree(np.radians(train[["latitude", "longitude"]].to_numpy()), metric="haversine")
    distance, index = tree.query(np.radians(test[["latitude", "longitude"]].to_numpy()), k=k)
    km = distance * 6371
    weights = np.where(km <= radius, 1 / np.maximum(km, 0.5) ** power, 0.0)
    total = weights.sum(axis=1)
    return np.where(total > 0, (weights * residual[index]).sum(axis=1) / np.where(total > 0, total, 1), 0.0)


def run_lgb(frame, features, overrides, truth, with_residual=False):
    prediction = np.zeros(len(frame))
    corrected = np.zeros(len(frame))
    for train_index, test_index in folds(frame):
        x_train, x_test = tg.matrices(frame, features, TARGET, train_index, test_index)
        model = tg.fit(x_train, truth[train_index], 0, **overrides)
        prediction[test_index] = model.predict(x_test)
        if with_residual:
            inner = np.zeros(len(train_index))
            sub = frame.iloc[train_index].reset_index(drop=True)
            for a, b in KFold(3, shuffle=True, random_state=5).split(sub):
                x_a, x_b = tg.matrices(sub, features, TARGET, a, b)
                inner[b] = tg.fit(x_a, truth[train_index][a], 0, **overrides).predict(x_b)
            residual = truth[train_index] - inner
            corrected[test_index] = prediction[test_index] + 0.6 * residual_idw(frame.iloc[train_index], residual, frame.iloc[test_index])
    return prediction, corrected


def forest(kind, frame, features, truth):
    prediction = np.zeros(len(frame))
    for train_index, test_index in folds(frame):
        x_train, x_test = tg.matrices(frame, features, TARGET, train_index, test_index)
        model = make_pipeline(SimpleImputer(strategy="median"), kind(n_estimators=500, min_samples_leaf=3, max_features=0.33, n_jobs=8, random_state=0))
        prediction[test_index] = model.fit(x_train, truth[train_index]).predict(x_test)
    return prediction


def main() -> None:
    frame = tg.load()
    results = json.load(open(DATA_DIR / "gw_results.json", encoding="utf-8"))
    kept = results["targets"][TARGET]["keptGroups"]
    features = tg.LOCAL + [name for group in kept for name in tg.GROUPS[group]]
    truth = tg.transform(frame[TARGET].to_numpy(), TARGET)
    actual = frame[TARGET].to_numpy()
    report, stored = {}, {}

    def note(name, values):
        stored[name] = values
        report[name] = tg.score(actual, tg.restore(values, TARGET), TARGET)
        print(name, {k: report[name][k] for k in ("maeM", "medianErrorM", "within2mPct", "depthBandAccuracyPct", "r2Log")}, flush=True)

    for name, overrides in OPTIONS.items():
        note(name, run_lgb(frame, features, overrides, truth)[0])
    note("random_forest", forest(RandomForestRegressor, frame, features, truth))
    note("extra_trees", forest(ExtraTreesRegressor, frame, features, truth))
    best = min((name for name in OPTIONS), key=lambda name: report[name]["maeM"] - report[name]["r2Log"])
    note(f"blend_{best}_rf_et", (stored[best] + stored["random_forest"] + stored["extra_trees"]) / 3)
    note(f"{best}_residual_kriging", run_lgb(frame, features, OPTIONS[best], truth, with_residual=True)[1])
    (DATA_DIR / "gw_experiments.json").write_text(json.dumps(report, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
