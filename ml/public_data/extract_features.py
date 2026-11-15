"""Sample open map layers at each well site, one CSV per feature group.

Run a group at a time; each is resumable. Groups:
  terrain, fracture  Copernicus GLO-30 DEM. The fracture group is a DEM-derived
                     proxy for lineaments, not mapped geology.
  weathering         SoilGrids depth to bedrock and soil texture
  water              CGWB quality-controlled water levels, nearest stations
  climate            CHIRPS v3 annual rainfall
  surface            ESA WorldCover shares around the site
"""
from __future__ import annotations

import math
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
from scipy import ndimage
from sklearn.neighbors import BallTree

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.vrt")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
os.environ.setdefault("GDAL_HTTP_TIMEOUT", "60")

import rasterio  # noqa: E402
from pyproj import Transformer  # noqa: E402
from rasterio.windows import Window  # noqa: E402

from config import DATA_DIR, FEATURE_DIR, SITES  # noqa: E402

ARC_SECOND = 1 / 3600
RADIUS_PX = 100  # about 3 km at 30 m
M_PER_DEG = 111_320
local = threading.local()


def dataset(url: str, overview_level: int | None = None):
    cache = getattr(local, "datasets", None)
    if cache is None:
        cache = local.datasets = {}
    key = (url, overview_level)
    if key not in cache:
        cache[key] = rasterio.open(url, overview_level=overview_level) if overview_level is not None else rasterio.open(url)
    return cache[key]


# --- DEM ---------------------------------------------------------------------

def dem_url(lat_floor: int, lng_floor: int) -> str:
    name = f"Copernicus_DSM_COG_10_N{lat_floor:02d}_00_E{lng_floor:03d}_00_DEM"
    return f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"


def read_dem(lat: float, lng: float, radius: int = RADIUS_PX) -> np.ndarray | None:
    size = 2 * radius + 1
    grid = np.full((size, size), np.nan, dtype=float)
    north = lat + radius * ARC_SECOND
    west = lng - radius * ARC_SECOND
    for lat_floor in {math.floor(lat - radius * ARC_SECOND), math.floor(north)}:
        for lng_floor in {math.floor(west), math.floor(lng + radius * ARC_SECOND)}:
            try:
                source = dataset(dem_url(lat_floor, lng_floor))
            except rasterio.errors.RasterioIOError:
                continue
            row, col = source.index(west, north)
            row_start, col_start = max(row, 0), max(col, 0)
            row_stop, col_stop = min(row + size, source.height), min(col + size, source.width)
            if row_stop <= row_start or col_stop <= col_start:
                continue
            data = source.read(1, window=Window(col_start, row_start, col_stop - col_start, row_stop - row_start))
            grid[row_start - row: row_stop - row, col_start - col: col_stop - col] = data
    if np.isnan(grid).mean() > 0.2:
        return None
    return np.where(np.isnan(grid), np.nanmean(grid), grid)


def flow_accumulation(z: np.ndarray) -> np.ndarray:
    """D8 upstream cell count inside the window. Windowed, so large valleys saturate."""
    rows, cols = z.shape
    padded = np.pad(z, 1, mode="edge")
    offsets = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    drops = np.stack([
        (z - padded[1 + dr: 1 + dr + rows, 1 + dc: 1 + dc + cols]) / math.hypot(dr, dc) for dr, dc in offsets
    ])
    best = drops.argmax(axis=0)
    receives = drops.max(axis=0) > 0
    row_offset = np.array([offset[0] for offset in offsets])[best]
    col_offset = np.array([offset[1] for offset in offsets])[best]
    target_row = np.arange(rows)[:, None] + row_offset
    target_col = np.arange(cols)[None, :] + col_offset
    inside = receives & (target_row >= 0) & (target_row < rows) & (target_col >= 0) & (target_col < cols)
    receiver = np.where(inside, target_row * cols + target_col, -1).ravel().tolist()
    accumulated = [1.0] * (rows * cols)
    for index in np.argsort(-z.ravel()).tolist():
        destination = receiver[index]
        if destination >= 0:
            accumulated[destination] += accumulated[index]
    return np.array(accumulated).reshape(rows, cols)


def terrain_features(z: np.ndarray, lat: float) -> dict:
    c = RADIUS_PX
    dy = ARC_SECOND * M_PER_DEG
    dx = dy * math.cos(math.radians(lat))
    smooth = ndimage.gaussian_filter(z, 1)
    grad_y, grad_x = np.gradient(smooth, dy, dx)
    slope = np.hypot(grad_x, grad_y)
    tpi = {radius: smooth - ndimage.uniform_filter(smooth, 2 * radius + 1, mode="nearest") for radius in (5, 17, 50, 100)}
    accumulated = flow_accumulation(smooth)
    upstream = accumulated[c - 1: c + 2, c - 1: c + 2].max()
    drains = accumulated >= 150
    distance, nearest = ndimage.distance_transform_edt(~drains, sampling=(dy, dx), return_indices=True)
    drain_elevation = smooth[nearest[0], nearest[1]]
    return {
        "elevation_m": float(z[c, c]),
        "slope": float(slope[c, c]),
        "relief_1km": float(np.ptp(z[c - 33: c + 34, c - 33: c + 34])),
        "tpi_150m": float(tpi[5][c, c]),
        "tpi_500m": float(tpi[17][c, c]),
        "tpi_1500m": float(tpi[50][c, c]),
        "tpi_3km": float(tpi[100][c, c]),
        "twi": float(math.log(upstream * dx * dy / dx / max(slope[c, c], 1e-3))),
        "log_upstream": float(math.log10(upstream)),
        "drain_distance_m": float(distance[c, c]),
        "hand_m": float(z[c, c] - drain_elevation[c, c]),
        "drain_density": float(drains.mean()),
    }


LINE_KERNELS = []
for degrees in range(0, 180, 15):
    kernel = np.zeros((31, 31))
    for step in np.linspace(-15, 15, 61):
        kernel[int(round(15 + step * math.sin(math.radians(degrees)))),
               int(round(15 + step * math.cos(math.radians(degrees))))] = 1
    LINE_KERNELS.append(kernel / kernel.sum())


def fracture_features(z: np.ndarray) -> dict:
    """Straight, narrow topographic lows at about 1 km length, as a lineament proxy."""
    c = RADIUS_PX
    valley = ndimage.gaussian_filter(z, 8) - ndimage.gaussian_filter(z, 1.5)
    responses = np.stack([ndimage.correlate(valley, kernel, mode="nearest") for kernel in LINE_KERNELS])
    strongest = responses.max(axis=0)
    spread = strongest.std() or 1.0
    score = (strongest - strongest.mean()) / spread
    lines = score > 1.5
    distance = ndimage.distance_transform_edt(~lines) * 30
    yy, xx = np.ogrid[:z.shape[0], :z.shape[1]]
    near = (yy - c) ** 2 + (xx - c) ** 2 <= 33 ** 2
    angles = np.radians(responses.argmax(axis=0) * 15) * 2
    weights = np.where(lines, strongest, 0)
    total = weights.sum() or 1.0
    coherence = math.hypot((weights * np.cos(angles)).sum(), (weights * np.sin(angles)).sum()) / total
    # Two distinct line directions close by approximate a fracture intersection.
    second = np.sort(responses, axis=0)[-2]
    crossing = float(((second - strongest.mean()) / spread)[near].max())
    return {
        "line_score": float(score[c, c]),
        "line_distance_m": float(distance[c, c]),
        "line_density_1km": float(lines[near].mean()),
        "line_density_3km": float(lines.mean()),
        "line_coherence": float(coherence),
        "line_crossing": crossing,
    }


def dem_row(site) -> dict | None:
    z = read_dem(site.latitude, site.longitude)
    if z is None:
        return None
    return {"site": int(site.site), **terrain_features(z, site.latitude), **fracture_features(z)}


# --- Other layers ------------------------------------------------------------

SOILGRIDS = "/vsicurl/https://files.isric.org/soilgrids"
TO_HOMOLOSINE = Transformer.from_crs(
    "EPSG:4326", "+proj=igh +lat_0=0 +lon_0=0 +datum=WGS84 +units=m +no_defs", always_xy=True)


def point(url: str, x: float, y: float, overview_level: int | None = None) -> float:
    source = dataset(url, overview_level)
    row, col = source.index(x, y)
    if not (0 <= row < source.height and 0 <= col < source.width):
        return float("nan")
    value = float(source.read(1, window=Window(col, row, 1, 1))[0, 0])
    return float("nan") if source.nodata is not None and value == source.nodata else value


def weathering_row(site) -> dict:
    lat, lng = site.latitude, site.longitude
    return {
        "site": int(site.site),
        "soilgrids_bedrock_cm": point(f"{SOILGRIDS}/former/2017-03-10/data/BDTICM_M_250m_ll.tif", lng, lat, 1),
        "soilgrids_r_horizon_cm": point(f"{SOILGRIDS}/former/2017-03-10/data/BDRICM_M_250m_ll.tif", lng, lat, 1),
    }


def soil_row(site) -> dict:
    x, y = TO_HOMOLOSINE.transform(site.longitude, site.latitude)
    return {
        "site": int(site.site),
        "clay_30cm": point(f"{SOILGRIDS}/latest/data/clay/clay_15-30cm_mean.vrt", x, y),
        "sand_30cm": point(f"{SOILGRIDS}/latest/data/sand/sand_15-30cm_mean.vrt", x, y),
    }


def worldcover_url(lat: float, lng: float) -> str:
    south = math.floor(lat / 3) * 3
    west = math.floor(lng / 3) * 3
    return ("/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
            f"ESA_WorldCover_10m_2021_v200_N{south:02d}E{west:03d}_Map.tif")


def surface_row(site) -> dict | None:
    lat, lng = site.latitude, site.longitude
    source = dataset(worldcover_url(lat, lng))
    row, col = source.index(lng, lat)
    half = 300  # 3 km at 10 m
    data = source.read(1, window=Window(col - half, row - half, 2 * half + 1, 2 * half + 1), boundless=True,
                       fill_value=0, out_shape=(121, 121), resampling=rasterio.enums.Resampling.nearest)
    water = data == 80
    distance = ndimage.distance_transform_edt(~water) * 50 if water.any() else np.full(data.shape, 4000.0)
    return {
        "site": int(site.site),
        "share_tree": float((data == 10).mean()),
        "share_scrub": float(np.isin(data, (20, 30)).mean()),
        "share_crop": float((data == 40).mean()),
        "share_built": float((data == 50).mean()),
        "share_bare": float((data == 60).mean()),
        "share_water": float(water.mean()),
        "water_distance_m": float(distance[60, 60]),
    }


def climate_table(sites: pd.DataFrame) -> pd.DataFrame:
    base = "/vsicurl/https://data.chc.ucsb.edu/products/CHIRPS/v3.0/annual/global/tifs/chirps-v3.0.{}.tif"
    years = []
    for year in range(2015, 2025):
        with rasterio.open(base.format(year)) as source:
            rows = np.array([source.index(lng, lat)[0] for lat, lng in zip(sites.latitude, sites.longitude)])
            cols = np.array([source.index(lng, lat)[1] for lat, lng in zip(sites.latitude, sites.longitude)])
            top, bottom = rows.min(), rows.max() + 1
            data = source.read(1, window=Window(0, top, source.width, bottom - top)).astype(float)
        data[data < 0] = np.nan
        years.append(data[rows - top, cols])
        print("chirps", year, flush=True)
    stack = np.stack(years)
    return pd.DataFrame({
        "site": sites.site, "rain_mean_mm": np.nanmean(stack, axis=0),
        "rain_cv": np.nanstd(stack, axis=0) / np.nanmean(stack, axis=0),
    })


def water_table(sites: pd.DataFrame) -> pd.DataFrame:
    def stations(name: str) -> pd.DataFrame:
        frame = pd.read_csv(DATA_DIR / f"{name}.csv")
        frame = frame[frame.WELL_DEPTH.between(0, 150)]
        frame["year"] = pd.to_datetime(frame.DATE, format="%d-%m-%y", errors="coerce").dt.year
        return frame.groupby(["LATITUDE", "LONGITUDE"]).agg(depth=("WELL_DEPTH", "mean")).reset_index()

    pre, post = stations("PRE"), stations("POST")
    merged = pre.merge(post, on=["LATITUDE", "LONGITUDE"], suffixes=("_pre", "_post"))
    tree = BallTree(np.radians(merged[["LATITUDE", "LONGITUDE"]].to_numpy()), metric="haversine")
    distance, index = tree.query(np.radians(sites[["latitude", "longitude"]].to_numpy()), k=5)
    km = distance * 6371
    weight = 1 / np.maximum(km, 0.5) ** 2
    weight = weight / weight.sum(axis=1, keepdims=True)
    depth_pre = (merged.depth_pre.to_numpy()[index] * weight).sum(axis=1)
    depth_post = (merged.depth_post.to_numpy()[index] * weight).sum(axis=1)
    return pd.DataFrame({
        "site": sites.site, "water_depth_pre_m": depth_pre, "water_depth_post_m": depth_post,
        "water_seasonal_rise_m": depth_pre - depth_post, "water_station_km": km[:, 0],
    })


# --- Runner ------------------------------------------------------------------

def run_per_site(name: str, worker, sites: pd.DataFrame, threads: int) -> None:
    path = FEATURE_DIR / f"{name}.csv"
    done = set(pd.read_csv(path).site) if path.exists() else set()
    todo = [site for site in sites.itertuples() if int(site.site) not in done]
    started = time.time()
    failures = 0

    def safe(site):
        nonlocal failures
        try:
            return worker(site)
        except Exception as error:  # a lost connection should not lose the run
            failures += 1
            if failures <= 5:
                print("failed", site.site, repr(error)[:160], flush=True)
            return None

    with ThreadPoolExecutor(threads) as pool:
        buffer = []
        for count, row in enumerate(pool.map(safe, todo), 1):
            if row:
                buffer.append(row)
            if len(buffer) >= 50 or count == len(todo):
                frame = pd.DataFrame(buffer)
                if len(frame):
                    frame.to_csv(path, mode="a", header=not path.exists(), index=False)
                buffer = []
                print(name, count, "of", len(todo), f"{time.time() - started:.0f}s failures={failures}", flush=True)


def main() -> None:
    FEATURE_DIR.mkdir(parents=True, exist_ok=True)
    sites = pd.read_csv(SITES)
    group = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else None
    if limit:
        sites = sites.sample(limit, random_state=1)
    if group == "dem":
        run_per_site("dem", dem_row, sites, 8)
    elif group == "weathering":
        run_per_site("weathering", weathering_row, sites, 6)
    elif group == "soil":
        run_per_site("soil", soil_row, sites, 6)
    elif group == "surface":
        run_per_site("surface", surface_row, sites, 8)
    elif group == "climate":
        climate_table(sites).to_csv(FEATURE_DIR / "climate.csv", index=False)
    elif group == "water":
        water_table(sites).to_csv(FEATURE_DIR / "water.csv", index=False)
    else:
        raise SystemExit(f"unknown group {group}")


if __name__ == "__main__":
    main()
