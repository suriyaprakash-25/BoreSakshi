"""Build the groundwater-station table from CGWB seasonal readings.

Targets are measured facts: depth to water before the monsoon (May), after it
(November), and the seasonal rise between them. Readings are for unconfined aquifers,
so they describe the shallow water table, not deep fracture yield.
"""
from __future__ import annotations

import json
import zipfile

import numpy as np
import pandas as pd

from config import AUDIT_GW, DATA_DIR, GW_DUG_WELLS, GW_EVIDENCE, GW_REGION, GW_SINCE, GW_STATIONS

RAW_ZIP = DATA_DIR / "gw" / "raw.zip"
RAW_MEMBER = "Quality_controlled_groundwater_levels_over_India/Input/1_India_GWLs_2000_2024_wells_within_India.csv"
MAX_DEPTH_M = 150


def readings(name: str) -> pd.DataFrame:
    frame = pd.read_csv(DATA_DIR / f"{name}.csv")
    south, west, north, east = GW_REGION
    frame = frame[frame.LATITUDE.between(south, north) & frame.LONGITUDE.between(west, east)]
    frame = frame[frame.WELL_DEPTH.between(0.01, MAX_DEPTH_M)].copy()
    frame["year"] = pd.to_datetime(frame.DATE, format="%d-%m-%y", errors="coerce").dt.year
    frame = frame.dropna(subset=["year"])
    # A single reading far from a station's own history is a typing or gauge error.
    grouped = frame.groupby(["LATITUDE", "LONGITUDE"]).WELL_DEPTH
    median = grouped.transform("median")
    spread = (frame.WELL_DEPTH - median).abs().groupby([frame.LATITUDE, frame.LONGITUDE]).transform("median")
    return frame[(frame.WELL_DEPTH - median).abs() <= np.maximum(5 * 1.4826 * spread, 3.0)]


def summary(frame: pd.DataFrame, label: str) -> pd.DataFrame:
    recent = frame[frame.year >= GW_SINCE]
    grouped = recent.groupby(["LATITUDE", "LONGITUDE"])
    table = grouped.WELL_DEPTH.agg(["median", "size"]).rename(columns={"median": f"{label}_m", "size": f"{label}_n"})
    table[f"{label}_first"] = frame.groupby(["LATITUDE", "LONGITUDE"]).year.min()
    return table


def evidence_tables(pre: pd.DataFrame, post: pd.DataFrame) -> dict:
    """Every station with a usable history, including those too sparse to train on.
    They add local evidence around a site without needing map features."""
    since = pre.year >= 2005
    levels = pre[since].groupby(["LATITUDE", "LONGITUDE"]).WELL_DEPTH.median().rename("pre_all_m").to_frame()
    levels = levels.join(post[post.year >= 2005].groupby(["LATITUDE", "LONGITUDE"]).WELL_DEPTH.median().rename("post_all_m"), how="outer").reset_index()
    levels = levels.rename(columns={"LATITUDE": "latitude", "LONGITUDE": "longitude"})
    levels.to_csv(GW_EVIDENCE, index=False)

    # How deep people had to dig nearby is a direct local record of the water table.
    with zipfile.ZipFile(RAW_ZIP) as archive, archive.open(RAW_MEMBER) as handle:
        raw = pd.read_csv(handle, low_memory=False, usecols=["Latitude", "Longitude", "Type of Well", "Well Depth"])
    raw["well_depth_m"] = pd.to_numeric(raw["Well Depth"], errors="coerce")
    south, west, north, east = GW_REGION
    dug = raw[(raw["Type of Well"] == "Dug well") & raw.well_depth_m.between(1, 60) & raw.Latitude.between(south, north) & raw.Longitude.between(west, east)]
    dug = dug.rename(columns={"Latitude": "latitude", "Longitude": "longitude"})[["latitude", "longitude", "well_depth_m"]]
    dug.to_csv(GW_DUG_WELLS, index=False)
    return {"evidenceStations": len(levels), "dugWellsWithDepth": len(dug)}


def main() -> None:
    pre, post = readings("PRE"), readings("POST")
    table = summary(pre, "pre").join(summary(post, "post"), how="inner").reset_index()
    table = table[(table.pre_n >= 2) & (table.post_n >= 2)].copy()
    table["rise_m"] = table.pre_m - table.post_m
    table["first_year"] = table[["pre_first", "post_first"]].min(axis=1).astype(int)
    table = table.rename(columns={"LATITUDE": "latitude", "LONGITUDE": "longitude"}).reset_index(drop=True)
    table.insert(0, "site", np.arange(len(table)))
    table.to_csv(GW_STATIONS, index=False)
    audit = {
        "stations": len(table),
        "since": GW_SINCE,
        "region": GW_REGION,
        "preMedianM": round(float(table.pre_m.median()), 2),
        "postMedianM": round(float(table.post_m.median()), 2),
        "riseMedianM": round(float(table.rise_m.median()), 2),
        **evidence_tables(pre, post),
    }
    AUDIT_GW.write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print(json.dumps(audit, indent=1))


if __name__ == "__main__":
    main()
