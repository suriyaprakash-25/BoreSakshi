"""Checks that a flat helper result is a finding and not a pipeline fault."""
from __future__ import annotations

import json

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.model_selection import GroupKFold

from config import DATA_DIR
from train_helpers import GROUP_ORDER, GROUPS, PARAMS, block_bootstrap, cross_predict, fold_matrix, load

OUTPUT = DATA_DIR / "helper_diagnostics.json"


def r2(truth: np.ndarray, prediction: np.ndarray, baseline: np.ndarray) -> float:
    return float(1 - ((truth - prediction) ** 2).mean() / ((truth - baseline) ** 2).mean())


def by_site_cv(frame: pd.DataFrame, features: list[str], target: str) -> np.ndarray:
    """Hold out whole sites, not regions. This is the deployment case where the
    area already has logged wells, so nearby evidence is available."""
    total = np.zeros(len(frame))
    for repeat in range(3):
        rng = np.random.default_rng(repeat)
        unique = frame.site.unique()
        mapping = dict(zip(rng.permutation(unique), np.arange(len(unique))))
        for train_index, test_index in GroupKFold(5).split(frame, groups=frame.site.map(mapping)):
            if not features:
                total[test_index] += frame.iloc[train_index][target].mean()
                continue
            x_train, x_test, y_train = fold_matrix(frame, features, target, train_index, test_index)
            total[test_index] += lgb.LGBMRegressor(random_state=repeat, **PARAMS).fit(x_train, y_train).predict(x_test)
    return total / 3


def main() -> None:
    frame = load()
    frame["log_bedrock"] = np.log10(frame.bedrock_m)
    every = [name for group in GROUP_ORDER if group != "neighbours" for name in GROUPS[group] if name in frame.columns]
    report: dict = {}

    data = frame[frame.yield_anomaly.notna()].reset_index(drop=True)
    target_std = data.yield_anomaly.std()

    # 1. Positive control: a known weak signal must be recovered by the same code.
    signal = (data.tpi_500m - data.tpi_500m.mean()) / data.tpi_500m.std()
    rng = np.random.default_rng(7)
    report["plantedSignal"] = {}
    for strength in [0.2, 0.35, 0.5]:
        planted = data.copy()
        planted["control"] = strength * signal * target_std + rng.permutation(data.yield_anomaly.to_numpy()) * np.sqrt(1 - strength ** 2)
        baseline = cross_predict(planted, [], "control")
        prediction = cross_predict(planted, every, "control")
        error_base = (planted.control - baseline) ** 2
        error_model = (planted.control - prediction) ** 2
        test = block_bootstrap(planted, error_base.to_numpy(), error_model.to_numpy())
        report["plantedSignal"][str(strength)] = {
            "r2": r2(planted.control.to_numpy(), prediction, baseline), "bestPossibleR2": strength ** 2, "detected": test["low"] > 0}

    # 2. Holding out sites rather than regions: is local evidence worth something?
    baseline = by_site_cv(data, [], "yield_anomaly")
    truth = data.yield_anomaly.to_numpy()
    report["yieldBySiteCv"] = {
        "neighboursOnly": r2(truth, by_site_cv(data, GROUPS["neighbours"], "yield_anomaly"), baseline),
        "mapLayersOnly": r2(truth, by_site_cv(data, every, "yield_anomaly"), baseline),
        "mapLayersAndNeighbours": r2(truth, by_site_cv(data, every + GROUPS["neighbours"], "yield_anomaly"), baseline),
    }
    bedrock = frame[frame.log_bedrock.notna()].reset_index(drop=True)
    baseline = by_site_cv(bedrock, [], "log_bedrock")
    truth = bedrock.log_bedrock.to_numpy()
    report["bedrockBySiteCv"] = {
        "neighboursOnly": r2(truth, by_site_cv(bedrock, GROUPS["neighbours"], "log_bedrock"), baseline),
        "mapLayersOnly": r2(truth, by_site_cv(bedrock, every, "log_bedrock"), baseline),
        "mapLayersAndNeighbours": r2(truth, by_site_cv(bedrock, every + GROUPS["neighbours"], "log_bedrock"), baseline),
    }

    # 3. Tamil Nadu alone, the closest public analogue of the pilot.
    tamil = data[data.state == "TN"].reset_index(drop=True)
    baseline = cross_predict(tamil, [], "yield_anomaly")
    report["tamilNaduOnly"] = {"rows": len(tamil), "r2": r2(tamil.yield_anomaly.to_numpy(), cross_predict(tamil, every, "yield_anomaly"), baseline)}

    # 4. Each feature on its own, with a block bootstrap interval on the correlation.
    keys, inverse = np.unique(tamil.block, return_inverse=True)
    rows = []
    boot = np.random.default_rng(3)
    groups = [np.flatnonzero(inverse == index) for index in range(len(keys))]
    for name in every:
        pair = tamil[[name, "yield_anomaly"]].dropna()
        if pair[name].nunique() < 3:
            continue
        rho = spearmanr(pair[name], pair.yield_anomaly).statistic
        samples = []
        for _ in range(300):
            chosen = np.concatenate([groups[index] for index in boot.integers(0, len(groups), len(groups))])
            sample = tamil.iloc[chosen][[name, "yield_anomaly"]].dropna()
            samples.append(spearmanr(sample[name], sample.yield_anomaly).statistic)
        low, high = np.nanpercentile(samples, [2.5, 97.5])
        rows.append({"feature": name, "rho": round(float(rho), 3), "low": round(float(low), 3), "high": round(float(high), 3)})
    rows.sort(key=lambda row: -abs(row["rho"]))
    report["tamilNaduSingleFeatures"] = rows[:10]
    report["tamilNaduFeaturesTested"] = len(rows)
    report["tamilNaduFeaturesExcludingZero"] = sum(1 for row in rows if row["low"] > 0 or row["high"] < 0)

    OUTPUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
