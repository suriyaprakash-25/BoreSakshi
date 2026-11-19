"""Build the India-wide groundwater table: shallow open wells and deep wells.

Shallow rows come from CGWB's seasonal readings for unconfined aquifers (mostly dug
wells). Deep rows come from the bore wells, tube wells and piezometers in CGWB's raw
archive, which read the deeper aquifer where water often sits well below 10 m.

Features already extracted for the earlier peninsular stations are carried over by
location, so only new sites need downloading.
"""
from __future__ import annotations

import json
import shutil
import zipfile

import numpy as np
import pandas as pd

from config import AUDIT_GW, DATA_DIR, GW_DUG_WELLS, GW_EVIDENCE, GW_SINCE, GW_STATIONS
from gw_build_stations import MAX_DEPTH_M, RAW_MEMBER, RAW_ZIP
from india_layers import INDIA

FEATURE_DIR = DATA_DIR / "features_gw"
CARRIED = ["dem", "surface", "weathering", "soil"]
DEEP_TYPES = ["Bore well", "Tube well", "Piezometer", "Dug cum bore well"]


def inside(frame: pd.DataFrame, lat: str, lng: str) -> pd.Series:
    south, west, north, east = INDIA
    return frame[lat].between(south, north) & frame[lng].between(west, east)


def seasonal(name: str) -> pd.DataFrame:
    frame = pd.read_csv(DATA_DIR / f"{name}.csv")
    frame = frame[inside(frame, "LATITUDE", "LONGITUDE") & frame.WELL_DEPTH.between(0.01, MAX_DEPTH_M)].copy()
    frame["year"] = pd.to_datetime(frame.DATE, format="%d-%m-%y", errors="coerce").dt.year
    frame = frame.dropna(subset=["year"])
    keys = [frame.LATITUDE, frame.LONGITUDE]
    median = frame.groupby(keys).WELL_DEPTH.transform("median")
    spread = (frame.WELL_DEPTH - median).abs().groupby(keys).transform("median")
    return frame[(frame.WELL_DEPTH - median).abs() <= np.maximum(5 * 1.4826 * spread, 3.0)]


def summarise(frame: pd.DataFrame, label: str) -> pd.DataFrame:
    recent = frame[frame.year >= GW_SINCE].groupby(["LATITUDE", "LONGITUDE"]).WELL_DEPTH.agg(["median", "size"])
    recent.columns = [f"{label}_m", f"{label}_n"]
    recent[f"{label}_first"] = frame.groupby(["LATITUDE", "LONGITUDE"]).year.min()
    return recent


def shallow_rows() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    pre, post = seasonal("PRE"), seasonal("POST")
    table = summarise(pre, "pre").join(summarise(post, "post"), how="inner").reset_index()
    table = table[(table.pre_n >= 2) & (table.post_n >= 2)].copy()
    table["kind"] = "shallow"
    return table, pre, post


def raw_archive() -> pd.DataFrame:
    with zipfile.ZipFile(RAW_ZIP) as archive, archive.open(RAW_MEMBER) as handle:
        return pd.read_csv(handle, low_memory=False)


def deep_rows(raw: pd.DataFrame) -> pd.DataFrame:
    def season(prefix: str) -> tuple[pd.Series, pd.Series, pd.Series]:
        columns = [name for name in raw.columns if name.startswith(prefix) and int(name[-2:]) >= GW_SINCE % 100]
        values = raw[columns].apply(pd.to_numeric, errors="coerce").abs()
        values = values.where((values >= 0.01) & (values <= MAX_DEPTH_M))
        first_columns = [name for name in raw.columns if name.startswith(prefix)]
        seen = raw[first_columns].apply(pd.to_numeric, errors="coerce").notna()
        first = seen.idxmax(axis=1).str[-2:].astype(int) + 2000
        return values.median(axis=1), values.notna().sum(axis=1), first.where(seen.any(axis=1))

    deep = raw[raw["Type of Well"].isin(DEEP_TYPES) & inside(raw, "Latitude", "Longitude")].copy()
    pre_m, pre_n, pre_first = season("May-")
    post_m, post_n, post_first = season("Nov-")
    deep = deep.assign(pre_m=pre_m, pre_n=pre_n, post_m=post_m, post_n=post_n,
                       first_year=pd.concat([pre_first, post_first], axis=1).min(axis=1).reindex(deep.index))
    deep = deep[deep.pre_n.reindex(deep.index) >= 2]
    deep = deep.rename(columns={"Latitude": "LATITUDE", "Longitude": "LONGITUDE"})
    deep["kind"] = "deep"
    deep["well_type"] = deep["Type of Well"]
    return deep[["LATITUDE", "LONGITUDE", "pre_m", "pre_n", "post_m", "post_n", "first_year", "kind", "well_type"]]


def evidence(pre: pd.DataFrame, post: pd.DataFrame, raw: pd.DataFrame) -> dict:
    levels = pre[pre.year >= 2005].groupby(["LATITUDE", "LONGITUDE"]).WELL_DEPTH.median().rename("pre_all_m").to_frame()
    levels = levels.join(post[post.year >= 2005].groupby(["LATITUDE", "LONGITUDE"]).WELL_DEPTH.median().rename("post_all_m"), how="outer")
    levels = levels.reset_index().rename(columns={"LATITUDE": "latitude", "LONGITUDE": "longitude"})
    levels.to_csv(GW_EVIDENCE, index=False)
    raw = raw.assign(well_depth_m=pd.to_numeric(raw["Well Depth"], errors="coerce"))
    dug = raw[(raw["Type of Well"] == "Dug well") & raw.well_depth_m.between(1, 60) & inside(raw, "Latitude", "Longitude")]
    dug = dug.rename(columns={"Latitude": "latitude", "Longitude": "longitude"})[["latitude", "longitude", "well_depth_m"]]
    dug.to_csv(GW_DUG_WELLS, index=False)
    return {"evidenceStations": len(levels), "dugWellsWithDepth": len(dug)}


def carry_features(table: pd.DataFrame) -> dict:
    """Re-key earlier per-site features to the new site ids by exact location."""
    old_sites = pd.read_csv(GW_STATIONS)[["site", "latitude", "longitude"]] if GW_STATIONS.exists() else None
    backup = DATA_DIR / "features_gw_v1"
    if old_sites is None or not FEATURE_DIR.exists():
        return {}
    if not backup.exists():
        shutil.copytree(FEATURE_DIR, backup)
    lookup = old_sites.merge(table[["site", "latitude", "longitude"]], on=["latitude", "longitude"], suffixes=("_old", ""))
    lookup = lookup.drop_duplicates("site_old")
    carried = {}
    for name in CARRIED:
        path = backup / f"{name}.csv"
        if not path.exists():
            continue
        features = pd.read_csv(path).rename(columns={"site": "site_old"}).merge(lookup[["site_old", "site"]], on="site_old")
        features = features.drop(columns="site_old")
        features[["site"] + [c for c in features.columns if c != "site"]].to_csv(FEATURE_DIR / f"{name}.csv", index=False)
        carried[name] = len(features)
    return carried


def main() -> None:
    shallow, pre, post = shallow_rows()
    raw = raw_archive()
    deep = deep_rows(raw)
    shallow["rise_m"] = shallow.pre_m - shallow.post_m
    shallow["first_year"] = shallow[["pre_first", "post_first"]].min(axis=1)
    shallow["well_type"] = "Open well"
    columns = ["LATITUDE", "LONGITUDE", "kind", "well_type", "pre_m", "pre_n", "post_m", "post_n", "rise_m", "first_year"]
    table = pd.concat([shallow[columns], deep.assign(rise_m=deep.pre_m - deep.post_m)[columns]], ignore_index=True)
    table = table.rename(columns={"LATITUDE": "latitude", "LONGITUDE": "longitude"})
    table["first_year"] = table.first_year.fillna(GW_SINCE).astype(int)
    table.insert(0, "site", np.arange(len(table)))
    carried = carry_features(table)
    table.to_csv(GW_STATIONS, index=False)
    audit = {
        "shallowStations": int((table.kind == "shallow").sum()),
        "deepWells": int((table.kind == "deep").sum()),
        "deepByType": table[table.kind == "deep"].well_type.value_counts().to_dict(),
        "shallowPreMedianM": round(float(table[table.kind == "shallow"].pre_m.median()), 2),
        "deepPreMedianM": round(float(table[table.kind == "deep"].pre_m.median()), 2),
        "region": INDIA,
        "since": GW_SINCE,
        "carriedFeatureRows": carried,
        **evidence(pre, post, raw),
    }
    AUDIT_GW.write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print(json.dumps(audit, indent=1))


if __name__ == "__main__":
    main()
