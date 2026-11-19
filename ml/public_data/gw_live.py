"""Groundwater outlook for any tapped location in India.

Every feature comes from the same code that built the training table: terrain and
land cover from extract_features, rainfall and satellite medians from india_layers,
geology from the GSI layers, and local evidence from train_groundwater. A location
therefore sees exactly the kind of values the model learned from.

The outlook describes the shallow water table (depth to water in open wells before
and after the monsoon). It is not a borewell success prediction.

  python gw_live.py LAT LNG      print the outlook for one location
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import threading
from collections import OrderedDict, namedtuple
from pathlib import Path

import geopandas as gpd
import joblib
import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely.geometry import Point
from shapely.strtree import STRtree
from sklearn.neighbors import BallTree

import extract_features as ef
import gsi_layers
import train_groundwater as tg
from config import GW_MODEL_DIR, GW_RESULTS
from india_layers import INDIA, LAYER_DIR, Layers

# Beyond this distance from any monitoring station the model is extrapolating. The
# region-block test held out whole 0.5 degree blocks, so up to about 50 km is tested.
MAX_STATION_KM = 50.0
# A blank map value is refused only if training almost never had one for that feature.
MAX_USUAL_BLANK = 0.02
CACHE_DEG = 0.005  # about 500 m; repeat taps on one field reuse the answer
CACHE_SIZE = 5000
Site = namedtuple("Site", "site latitude longitude")


class OutlookError(Exception):
    code = "OUTLOOK_FAILED"


class OutsideCoverage(OutlookError):
    code = "OUTSIDE_COVERAGE"


class LowCoverage(OutlookError):
    code = "LOW_COVERAGE"


class SourceUnavailable(OutlookError):
    code = "FEATURE_SOURCE_UNAVAILABLE"


class GeologyIndex:
    """Point lookups against the India-wide GSI layers, matching gsi_layers.main."""

    def __init__(self, layer_dir: Path = LAYER_DIR) -> None:
        geology = gpd.read_file(layer_dir / "gsi_geology_india.gpkg")[["INDEX_", "Age", "geometry"]]
        geology = geology[geology.geometry.notna() & ~geology.geometry.is_empty].reset_index(drop=True)
        self.units = geology.INDEX_.to_numpy()
        self.ages = geology.Age.to_numpy()
        self.polygons = STRtree(geology.geometry.values)
        metric = geology.to_crs(gsi_layers.METRIC_CRS)
        self.contacts = STRtree(metric.boundary.values)
        self.lines = {name: STRtree(gpd.read_file(layer_dir / f"gsi_{name}_india.gpkg").to_crs(gsi_layers.METRIC_CRS).geometry.values)
                      for name in ("faults", "thrusts")}
        self.to_metric = Transformer.from_crs("EPSG:4326", gsi_layers.METRIC_CRS, always_xy=True)

    def features(self, lat: float, lng: float) -> dict:
        hits = self.polygons.query(Point(lng, lat), predicate="within")
        # The downloaded GSI layer has holes. As in training, such places are "unmapped"
        # rather than refused; the model learned that category from about 5% of stations.
        index = int(np.min(hits)) if len(hits) else None
        unit = str(self.units[index]) if index is not None else "unmapped"
        point = Point(*self.to_metric.transform(lng, lat))

        def nearest_km(tree: STRtree) -> float:
            _, distance = tree.query_nearest(point, return_distance=True)
            return float(distance[0]) / 1000

        return {
            "gsi_unit": unit,
            "gsi_age_rank": gsi_layers.age_rank(self.ages[index] if index is not None else ""),
            "gsi_family": gsi_layers.family(unit),
            "faults_distance_km": nearest_km(self.lines["faults"]),
            "thrusts_distance_km": nearest_km(self.lines["thrusts"]),
            "contact_distance_km": nearest_km(self.contacts),
        }


def file_version(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return "gw-" + digest.hexdigest()[:12]


class LiveGroundwater:
    def __init__(self, model_path: Path | None = None, results_path: Path | None = None,
                 geology: GeologyIndex | None = None, layers: Layers | None = None, remote=None) -> None:
        model_path = Path(model_path or GW_MODEL_DIR / "groundwater_model.joblib")
        self.package = joblib.load(model_path)
        self.model_version = file_version(model_path)
        self.stations = self.package["stations"].reset_index(drop=True)
        self.station_tree = BallTree(np.radians(self.stations[["latitude", "longitude"]].to_numpy()), metric="haversine")
        self.geology = geology or GeologyIndex()
        self.layers = layers or Layers()
        self.remote = remote or remote_features
        self.validation = validation_summary(Path(results_path or GW_RESULTS))
        self.cache: OrderedDict = OrderedDict()
        self.lock = threading.Lock()

    # -- features ------------------------------------------------------------
    def features(self, lat: float, lng: float) -> pd.DataFrame:
        remote = self.remote(lat, lng)
        if remote.get("share_water", 0) > 0.9 and remote.get("water_distance_m", 1) == 0:
            raise OutsideCoverage("This spot is open water (sea, lake or reservoir).")
        row = {"site": 0, "latitude": lat, "longitude": lng, **self.geology.features(lat, lng), **remote}
        frame = pd.DataFrame([row])
        sampled = self.layers.sample(np.array([lat]), np.array([lng]))
        frame = pd.concat([frame, sampled.reset_index(drop=True)], axis=1)
        categories = self.package["categories"]
        frame["gsi_family_code"] = frame.gsi_family.map(categories["family"]).astype(float)
        frame["gsi_unit_code"] = frame.gsi_unit.map(categories["unit"]).fillna(categories["unit"].get("rare", -1)).astype(float)
        frame["block"] = tg.block_of(frame)
        frame["key"] = "live"
        return frame

    def evidence(self, frame: pd.DataFrame, target: str) -> pd.DataFrame:
        return pd.concat([tg.local_evidence(self.stations, frame, target, False),
                          tg.history_evidence(frame, target, set(), set())], axis=1)

    # -- prediction ----------------------------------------------------------
    def nearest_station_km(self, lat: float, lng: float) -> float:
        distance, _ = self.station_tree.query(np.radians([[lat, lng]]), k=1)
        return float(distance[0, 0] * 6371)

    def predict(self, lat: float, lng: float) -> dict:
        south, west, north, east = INDIA
        if not (south <= lat <= north and west <= lng <= east):
            raise OutsideCoverage("BoreSakshi's groundwater model covers India only.")
        key = (round(lat / CACHE_DEG), round(lng / CACHE_DEG))
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
        station_km = self.nearest_station_km(lat, lng)
        if station_km > MAX_STATION_KM:
            raise LowCoverage(f"The nearest monitored well is {station_km:.0f} km away, too far for an honest estimate.")
        frame = self.features(lat, lng)
        result = self.score(frame, station_km)
        result["validation"] = validation_for(self.validation, lat, lng)
        with self.lock:
            self.cache[key] = result
            while len(self.cache) > CACHE_SIZE:
                self.cache.popitem(last=False)
        return result

    def score(self, frame: pd.DataFrame, station_km: float) -> dict:
        seasons = {}
        for target, label in (("pre_m", "preMonsoon"), ("post_m", "postMonsoon")):
            entry = self.package["models"][target]
            table = pd.concat([frame, self.evidence(frame, target)], axis=1)[entry["features"]]
            usual = self.package.get("trainingMissingRate", {})
            missing = [name for name in entry["features"]
                       if name not in tg.LOCAL and table[name].isna().any() and usual.get(name, 0.0) < MAX_USUAL_BLANK]
            if missing:
                raise LowCoverage("Some map layers have no data here: " + ", ".join(sorted(missing)[:6]))
            centre = float(entry["model"].predict(table)[0])
            seasons[label] = {
                "depthM": round(float(np.expm1(centre)), 2),
                "lowM": round(float(max(np.expm1(centre - entry["halfWidth"]), 0.0)), 2),
                "highM": round(float(np.expm1(centre + entry["halfWidth"])), 2),
            }
        shallow = self.package["shallow"]
        table = pd.concat([frame, self.evidence(frame, "pre_m")], axis=1)[shallow["features"]]
        chance = float(shallow["calibrator"].predict(shallow["model"].predict_proba(table)[:, 1])[0])
        values = [seasons[s][k] for s in seasons for k in ("depthM", "lowM", "highM")] + [chance]
        if not all(math.isfinite(value) for value in values):
            raise OutlookError("The model returned a non-finite value.")
        row = frame.iloc[0]
        return {
            "available": True,
            "modelVersion": self.model_version,
            "preMonsoon": seasons["preMonsoon"],
            "postMonsoon": seasons["postMonsoon"],
            "seasonalRiseM": round(seasons["preMonsoon"]["depthM"] - seasons["postMonsoon"]["depthM"], 2),
            "chanceWithin10m": round(chance, 3),
            "intervalCoveragePct": 80,
            "rockUnit": str(row.gsi_unit),
            "rockFamily": str(row.gsi_family),
            "elevationM": round(float(row.elevation_m), 1),
            "nearestStationKm": round(station_km, 1),
            "validation": self.validation,
            "describes": "shallow_water_table",
        }


def drop_cached_rasters() -> None:
    """A read that stalled can leave an open raster unusable; start this thread afresh."""
    for source in getattr(ef.local, "datasets", {}).values():
        try:
            source.close()
        except Exception:  # already broken
            pass
    ef.local.datasets = {}


def remote_features(lat: float, lng: float) -> dict:
    """Terrain and land cover read from the public cloud rasters, as in training."""
    site = Site(0, lat, lng)
    for attempt in (1, 2):
        try:
            terrain = ef.dem_row(site)
            cover = ef.surface_row(site)
            break
        except Exception as error:  # network or raster read failure
            drop_cached_rasters()
            if attempt == 2:
                raise SourceUnavailable(f"Map data could not be read right now ({type(error).__name__}).") from error
    if terrain is None or cover is None:
        raise SourceUnavailable("Terrain data is missing for this location.")
    terrain.pop("site", None)
    cover.pop("site", None)
    return {**terrain, **cover}


def validation_summary(path: Path) -> dict:
    """The honest held-out scores shipped with the model, for display."""
    if not path.exists():
        return {}
    results = json.loads(path.read_text(encoding="utf-8"))
    pre = results.get("targets", {}).get("pre_m", {})
    region = pre.get("regionTest", {}).get("model", {})
    areas = {name: {"preMonsoonMaeM": value.get("maeM"), "preMonsoonWithin2mPct": value.get("within2mPct")}
             for name, value in pre.get("regionalRegionTest", {}).items()}
    return {
        "stations": results.get("stations"),
        "test": "held-out 0.5 degree regions",
        "area": "india",
        "preMonsoonMaeM": region.get("maeM"),
        "preMonsoonWithin2mPct": region.get("within2mPct"),
        "intervalCoveragePct": pre.get("interval", {}).get("coveragePct"),
        "areas": areas,
    }


def area_of(lat: float, lng: float) -> str:
    """The test area whose held-out score best describes this location."""
    if 8 <= lat <= 13.6 and 76.2 <= lng <= 80.4:
        return "tamilNaduBox"
    return "peninsula" if lat < 22 else "northIndia"


def validation_for(validation: dict, lat: float, lng: float) -> dict:
    """Show the error measured where the farmer is, not the all-India average."""
    area = area_of(lat, lng)
    local = validation.get("areas", {}).get(area)
    summary = {key: value for key, value in validation.items() if key != "areas"}
    if local and local.get("preMonsoonMaeM") is not None:
        summary.update(local, area=area)
    return summary


if __name__ == "__main__":
    outlook = LiveGroundwater().predict(float(sys.argv[1]), float(sys.argv[2]))
    print(json.dumps(outlook, indent=1))
