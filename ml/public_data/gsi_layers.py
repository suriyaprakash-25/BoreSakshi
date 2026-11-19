"""Download GSI 1:2M geology, faults and thrusts, then sample them at each site.

Source: Geological Survey of India layers served by the British Geological Survey
through OneGeology. The service is for free viewing, so derived features stay in the
git-ignored data directory until the terms are confirmed with GSI.
"""
from __future__ import annotations

import math
import time

import geopandas as gpd
import mapbox_vector_tile
import numpy as np
import pandas as pd
import requests
from shapely.geometry import shape
from shapely.ops import transform, unary_union

from config import DATA_DIR, FEATURE_DIR, GW_REGION, SITES

WMS = "https://ogc.bgs.ac.uk/cgi-bin/BGS_GSI_Geology/wms"
LAYERS = {"geology": "IND_GSI_2M_Geology", "faults": "IND_GSI_2M_Faults", "thrusts": "IND_GSI_2M_Thrusts"}
TILE_DEG = 3
EXTENT = 4096
CACHE = DATA_DIR / "gw"
METRIC_CRS = "EPSG:32644"

FAMILIES = [
    ("alluvium", "alluvi|recent|quaternary|coastal|sand|cuddalore"),
    ("basalt", "deccan|trap|basalt"),
    ("laterite", "laterite"),
    ("sedimentary", "sandstone|shale|limestone|gondwana|kurnool|cuddapah|bhima|vindhyan|chhattisgarh|kaladgi|group"),
    ("charnockite", "charnock|khondalite|granulite|eastern ghat"),
    ("schist", "schist|dharwar|sargur|greenstone|sakoli|sausar"),
    ("granite", "granit|closepet"),
    ("gneiss", "gneiss|migmatite|gondite|tgg|peninsular"),
]


def to_mercator(lng: float, lat: float) -> tuple[float, float]:
    return lng * 20037508.34 / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137


def from_mercator(x, y, z=None):
    return (np.asarray(x) * 180 / 20037508.34,
            np.degrees(2 * np.arctan(np.exp(np.asarray(y) / 6378137))) - 90)


def fetch_tile(layer: str, west: float, south: float) -> list[dict]:
    left, bottom = to_mercator(west, south)
    right, top = to_mercator(west + TILE_DEG, south + TILE_DEG)
    response = requests.get(WMS, params={
        "service": "WMS", "version": "1.1.1", "request": "GetMap", "layers": layer, "srs": "EPSG:3857",
        "bbox": f"{left},{bottom},{right},{top}", "width": EXTENT, "height": EXTENT, "styles": "",
        "format": "application/vnd.mapbox-vector-tile",
    }, timeout=120)
    response.raise_for_status()
    decoded = mapbox_vector_tile.decode(response.content, default_options={"y_coord_down": False})
    rows = []
    for content in decoded.values():
        scale_x, scale_y = (right - left) / content["extent"], (top - bottom) / content["extent"]
        for feature in content["features"]:
            geometry = transform(lambda x, y, z=None: from_mercator(left + np.asarray(x) * scale_x, bottom + np.asarray(y) * scale_y),
                                 shape(feature["geometry"]))
            rows.append({**feature["properties"], "geometry": geometry})
    return rows


def download(name: str, region: tuple = GW_REGION, path=None) -> gpd.GeoDataFrame:
    path = path or CACHE / f"gsi_{name}.gpkg"
    if path.exists():
        return gpd.read_file(path)
    south, west, north, east = region
    rows = []
    for lat in range(int(south) - 1, int(north) + 1, TILE_DEG):
        for lng in range(int(west) - 1, int(east) + 1, TILE_DEG):
            rows += fetch_tile(LAYERS[name], lng, lat)
            time.sleep(0.3)
    frame = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    frame = frame[frame.geometry.notna() & ~frame.geometry.is_empty]
    frame["geometry"] = frame.geometry.make_valid()
    frame.to_file(path, driver="GPKG")
    return frame


def family(text: str) -> str:
    lowered = str(text).lower()
    return next((name for name, pattern in FAMILIES if pd.Series([lowered]).str.contains(pattern).iloc[0]), "other")


def age_rank(text: str) -> int:
    lowered = str(text).lower()
    order = ["quaternary", "recent", "pleistocene", "tertiary", "neogene", "cretaceous", "jurassic", "permian",
             "carboniferous", "palaeozoic", "paleozoic", "neoproterozoic", "proterozoic", "archaean", "archean"]
    return next((index for index, word in enumerate(order) if word in lowered), len(order))


def main() -> None:
    sites = pd.read_csv(SITES)
    points = gpd.GeoDataFrame(sites[["site"]], geometry=gpd.points_from_xy(sites.longitude, sites.latitude), crs="EPSG:4326")
    # India-wide layers, shared with live prediction.
    from india_layers import INDIA, LAYER_DIR
    india = lambda name: download(name, region=INDIA, path=LAYER_DIR / f"gsi_{name}_india.gpkg")
    geology = india("geology")
    print("geology polygons", len(geology), "units", geology.INDEX_.nunique(), flush=True)
    joined = gpd.sjoin(points, geology[["INDEX_", "Age", "geometry"]], how="left", predicate="within")
    joined = joined.drop_duplicates("site").set_index("site")

    table = pd.DataFrame({"site": sites.site})
    table["gsi_unit"] = table.site.map(joined.INDEX_).fillna("unmapped")
    table["gsi_age_rank"] = table.site.map(joined.Age).map(age_rank)
    table["gsi_family"] = table.gsi_unit.map(family)

    projected = points.to_crs(METRIC_CRS)
    for name in ("faults", "thrusts"):
        lines = india(name)
        print(name, len(lines), flush=True)
        merged = unary_union(lines.to_crs(METRIC_CRS).geometry.values)
        table[f"{name}_distance_km"] = projected.geometry.distance(merged).to_numpy() / 1000

    outline = unary_union(geology.to_crs(METRIC_CRS).boundary.values)
    table["contact_distance_km"] = projected.geometry.distance(outline).to_numpy() / 1000
    table.to_csv(FEATURE_DIR / "gsi.csv", index=False)
    print(table.gsi_family.value_counts().to_dict())
    print(table.gsi_unit.value_counts().head(15).to_dict())


if __name__ == "__main__":
    main()
