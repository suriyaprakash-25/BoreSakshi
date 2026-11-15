"""Predict groundwater across the pilot area and write a lookup map.

  python gw_map.py grid          create the grid to extract features for
  python gw_map.py predict       score it, once features exist
  python gw_map.py at LAT LNG    print the nearest map cell

The map is groundwater context for the shallow aquifer. It is not a borewell success
prediction and carries no information about dry holes.
"""
from __future__ import annotations

import json
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

import train_groundwater as tg
from config import DATA_DIR, EXCLUDED_BOX, GW_GRID, GW_MAP, GW_MODEL_DIR

STEP_DEG = 0.01
FEATURE_FILES = ["dem", "gsi", "weathering", "soil", "climate", "modis", "surface"]


def make_grid() -> None:
    south, west, north, east = EXCLUDED_BOX
    lats = np.round(np.arange(south, north + 1e-9, STEP_DEG), 4)
    lngs = np.round(np.arange(west, east + 1e-9, STEP_DEG), 4)
    grid = pd.DataFrame([(lat, lng) for lat in lats for lng in lngs], columns=["latitude", "longitude"])
    grid.insert(0, "site", np.arange(len(grid)))
    grid.to_csv(GW_GRID, index=False)
    print("grid cells", len(grid))


def load_grid(package: dict) -> pd.DataFrame:
    frame = pd.read_csv(GW_GRID)
    features = DATA_DIR / "features_grid"
    for name in FEATURE_FILES:
        frame = frame.merge(pd.read_csv(features / f"{name}.csv").drop_duplicates("site"), on="site", how="left")
    categories = package["categories"]
    frame["gsi_family_code"] = frame.gsi_family.map(categories["family"]).astype(float)
    frame["gsi_unit_code"] = frame.gsi_unit.map(categories["unit"]).fillna(categories["unit"].get("rare", -1)).astype(float)
    frame["block"] = tg.block_of(frame)
    frame["key"] = "grid"
    return frame


def evidence_at(frame: pd.DataFrame, stations: pd.DataFrame, target: str) -> pd.DataFrame:
    return pd.concat([tg.local_evidence(stations, frame, target, False), tg.history_evidence(frame, target, set(), set())], axis=1)


def predict() -> None:
    package = joblib.load(GW_MODEL_DIR / "groundwater_model.joblib")
    frame = load_grid(package)
    stations = package["stations"]
    output = frame[["latitude", "longitude", "elevation_m", "gsi_unit"]].copy()
    for target in ("pre_m", "post_m"):
        entry = package["models"][target]
        table = pd.concat([frame, evidence_at(frame, stations, target)], axis=1)[entry["features"]]
        centre = entry["model"].predict(table)
        output[target] = np.expm1(centre)
        output[f"{target}_low"] = np.maximum(np.expm1(centre - entry["halfWidth"]), 0)
        output[f"{target}_high"] = np.expm1(centre + entry["halfWidth"])
    # Rise is the gap between the two depths, so the three numbers always agree. This
    # costs little: 1.44 m typical error against 1.41 m for a separate rise model.
    output["rise_m"] = output.pre_m - output.post_m
    shallow = package["shallow"]
    table = pd.concat([frame, evidence_at(frame, stations, "pre_m")], axis=1)[shallow["features"]]
    output["chance_within_10m"] = shallow["calibrator"].predict(shallow["model"].predict_proba(table)[:, 1])
    points = BallTree(np.radians(stations[["latitude", "longitude"]].to_numpy()), metric="haversine")
    output["nearest_station_km"] = points.query(np.radians(frame[["latitude", "longitude"]].to_numpy()), k=1)[0][:, 0] * 6371
    output.round(3).to_csv(GW_MAP, index=False)
    print(json.dumps({"cells": len(output), "preMedianM": round(float(output.pre_m.median()), 2),
                      "postMedianM": round(float(output.post_m.median()), 2),
                      "chanceMedian": round(float(output.chance_within_10m.median()), 3),
                      "chanceBelow70Pct": round(float((output.chance_within_10m < 0.7).mean() * 100), 1)}, indent=1))


def at(lat: float, lng: float) -> None:
    table = pd.read_csv(GW_MAP)
    tree = BallTree(np.radians(table[["latitude", "longitude"]].to_numpy()), metric="haversine")
    distance, index = tree.query(np.radians([[lat, lng]]), k=1)
    if distance[0, 0] * 6371 > 1.5:
        raise SystemExit("This location is outside the groundwater map.")
    row = table.iloc[index[0, 0]]
    print(f"Location        {lat}, {lng}")
    print(f"Before monsoon  {row.pre_m:.1f} m to water (likely {row.pre_m_low:.1f} to {row.pre_m_high:.1f} m)")
    print(f"After monsoon   {row.post_m:.1f} m to water (likely {row.post_m_low:.1f} to {row.post_m_high:.1f} m)")
    print(f"Seasonal rise   {row.rise_m:.1f} m")
    print(f"Chance water is within 10 m before the monsoon: {row.chance_within_10m:.0%}")
    print(f"Rock unit       {row.gsi_unit}")
    print(f"Nearest monitored station {row.nearest_station_km:.1f} km away")
    print("This describes the shallow water table. It is not a borewell result.")


if __name__ == "__main__":
    command = sys.argv[1]
    if command == "grid":
        make_grid()
    elif command == "predict":
        predict()
    else:
        at(float(sys.argv[2]), float(sys.argv[3]))
