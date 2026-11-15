"""Clean the public wells into a helper-model table.

Rules from docs/ml-data-and-training-plan.md:
- pilot-box readings are removed before anything else, and that is asserted;
- only crystalline-rock wells are kept;
- fields known only after drilling and drilling year are kept out of the features;
- blank discharge stays unknown. It is never treated as a dry hole;
- wells at one site share a site id so they can't straddle train and test.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from sklearn.neighbors import BallTree

from config import AUDIT, BLOCK_DEG, EXCLUDED_BOX, MAX_BEDROCK_M, MAX_DISCHARGE, RAW_WELLS, SITE_RADIUS_M, SITES, WELLS

CRYSTALLINE = "gneiss|granit|charnock|chamock|schist|crystalline|migmatit|khondalite|amphibolite"
NON_CRYSTALLINE = "sandstone|standstone|alluvi|limestone|basalt|laterite|shale|clay|deccan"
EARTH_RADIUS_M = 6_371_000


def number(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series.astype(str).str.strip(), errors="coerce")


def inside_excluded_box(frame: pd.DataFrame) -> pd.Series:
    south, west, north, east = EXCLUDED_BOX
    return frame.latitude.between(south, north) & frame.longitude.between(west, east)


def rock_family(lithology: pd.Series) -> pd.Series:
    text = lithology.str.lower()
    conditions = [
        text.str.contains("charnock|chamock"),
        text.str.contains("schist|khondalite|amphibolite"),
        text.str.contains("granite gneiss|granitic gneiss|gneiss"),
        text.str.contains("granit"),
    ]
    return pd.Series(np.select(conditions, ["charnockite", "schist", "gneiss", "granite"], "other"), index=lithology.index)


def assign_sites(frame: pd.DataFrame) -> np.ndarray:
    points = np.radians(frame[["latitude", "longitude"]].to_numpy())
    pairs = BallTree(points, metric="haversine").query_radius(points, r=SITE_RADIUS_M / EARTH_RADIUS_M)
    rows = np.concatenate([np.full(len(found), index) for index, found in enumerate(pairs)])
    columns = np.concatenate(pairs)
    graph = coo_matrix((np.ones(len(rows)), (rows, columns)), shape=(len(frame), len(frame)))
    return connected_components(graph, directed=False)[1]


def main() -> None:
    raw = pd.DataFrame(json.loads(RAW_WELLS.read_text(encoding="utf-8")))
    raw = raw[raw.latitude.between(6, 38) & raw.longitude.between(68, 98)].copy()

    in_box = inside_excluded_box(raw)
    excluded = int(in_box.sum())
    wells = raw[~in_box].copy()
    assert not inside_excluded_box(wells).any(), "pilot-box readings must not reach the training table"

    lithology = wells.maj_lithol.astype(str)
    wells = wells[lithology.str.contains(CRYSTALLINE, case=False) & ~lithology.str.contains(NON_CRYSTALLINE, case=False)].copy()
    wells["state"] = wells.state.astype(str).str.strip().str.upper()
    wells["rock"] = rock_family(wells.maj_lithol.astype(str))
    wells["depth_m"] = number(wells.depth_dril)
    wells["discharge"] = number(wells.discharge)
    wells["bedrock_m"] = number(wells.depth_bedr)
    wells["year"] = pd.to_numeric(wells.year_drill.astype(str).str.extract(r"((?:19|20)\d\d)")[0], errors="coerce")
    wells["decade"] = (wells.year // 10 * 10).astype("Int64").astype(str)
    wells["well_type"] = wells.well_type.astype(str).str.strip()

    wells.loc[~wells.discharge.between(1e-6, MAX_DISCHARGE, inclusive="right"), "discharge"] = np.nan
    bad_bedrock = ~wells.bedrock_m.between(0.5, MAX_BEDROCK_M) | (wells.bedrock_m >= wells.depth_m)
    wells.loc[bad_bedrock, "bedrock_m"] = np.nan
    wells["log_q"] = np.log10(wells.discharge)
    wells["batch"] = wells.state + "|" + wells.decade

    # Yield is recorded on a different basis across state and decade, so the target
    # is each well's yield relative to its own batch.
    batch_median = wells.groupby("batch").log_q.transform("median")
    batch_size = wells.groupby("batch").log_q.transform("count")
    wells["yield_anomaly"] = (wells.log_q - batch_median).where(batch_size >= 10)

    wells["site"] = assign_sites(wells)
    wells["block"] = (np.floor(wells.latitude / BLOCK_DEG).astype(int).astype(str) + "_" +
                      np.floor(wells.longitude / BLOCK_DEG).astype(int).astype(str))

    columns = ["llcode", "state", "district", "block", "latitude", "longitude", "site", "rock", "well_type", "year",
               "decade", "batch", "depth_m", "discharge", "log_q", "yield_anomaly", "bedrock_m"]
    wells = wells.rename(columns={"block": "admin_block"}).assign(block=wells.block)[
        ["llcode", "state", "district", "admin_block", "latitude", "longitude", "site", "rock", "well_type", "year",
         "decade", "batch", "depth_m", "discharge", "log_q", "yield_anomaly", "bedrock_m", "block"]]
    wells.to_csv(WELLS, index=False)
    sites = wells.groupby("site").agg(latitude=("latitude", "mean"), longitude=("longitude", "mean"), wells=("site", "size")).reset_index()
    sites.to_csv(SITES, index=False)

    audit = {
        "rawRows": int(len(raw)),
        "excludedPilotBoxRows": excluded,
        "crystallineRows": int(len(wells)),
        "sites": int(len(sites)),
        "spatialBlocks": int(wells.block.nunique()),
        "withDischarge": int(wells.discharge.notna().sum()),
        "withYieldAnomaly": int(wells.yield_anomaly.notna().sum()),
        "withBedrock": int(wells.bedrock_m.notna().sum()),
        "states": wells.state.value_counts().to_dict(),
        "medianDischargeByStateDecade": {
            key: {"n": int(group.discharge.notna().sum()), "median": round(float(group.discharge.median()), 3)}
            for key, group in wells.groupby("batch") if group.discharge.notna().sum() >= 10
        },
    }
    AUDIT.write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print(json.dumps(audit, indent=1))


if __name__ == "__main__":
    main()
