"""Precompute India-wide rainfall, satellite and geology layers.

Training and live prediction both sample these same files, so a location scored in
the app sees exactly the kind of values the model learned from, in well under a
second. MODIS medians are stored at about 1 km to keep the files small.

  python india_layers.py all          build every layer (resumable)
  python india_layers.py sample       add these features to the active site set
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_TIMEOUT", "90")
os.environ.setdefault("GDAL_CACHEMAX", "128")

import rasterio  # noqa: E402
from pyproj import Transformer  # noqa: E402
from rasterio.windows import Window  # noqa: E402

from config import DATA_DIR, FEATURE_DIR, SITES  # noqa: E402

INDIA = (6.0, 68.0, 37.5, 97.5)  # south, west, north, east
LAYER_DIR = DATA_DIR / "layers"
MODIS_DIR = LAYER_DIR / "modis"
YEARS = [2022, 2023, 2024]
TILE_M = 1111950.5197665
ORIGIN_X, ORIGIN_Y = -18 * TILE_M, 9 * TILE_M
STORED = 1200  # pixels per MODIS tile edge as stored, about 1 km
TO_SINUSOIDAL = Transformer.from_crs("EPSG:4326", "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs", always_xy=True)

PRODUCTS = {
    "ndvi_dry": ("modis-13A1-061", "500m_16_days_NDVI", "{y}-03-01/{y}-05-15", 0.0001),
    "ndvi_wet": ("modis-13A1-061", "500m_16_days_NDVI", "{y}-10-01/{y}-12-15", 0.0001),
    "lst_dry_k": ("modis-11A2-061", "LST_Day_1km", "{y}-03-15/{y}-05-15", 0.02),
    "et_mm": ("modis-16A3GF-061", "ET_500m", "{y}-01-01/{y}-01-31", 0.1),
    "pet_mm": ("modis-16A3GF-061", "PET_500m", "{y}-01-01/{y}-01-31", 0.1),
}


def modis_tiles() -> list[tuple[int, int]]:
    south, west, north, east = INDIA
    lats, lngs = np.meshgrid(np.arange(south, north, 0.25), np.arange(west, east, 0.25))
    x, y = TO_SINUSOIDAL.transform(lngs.ravel(), lats.ravel())
    h = np.floor((np.asarray(x) - ORIGIN_X) / TILE_M).astype(int)
    v = np.floor((ORIGIN_Y - np.asarray(y)) / TILE_M).astype(int)
    return sorted(set(zip(h.tolist(), v.tolist())))


def read_scene(href: str, scale: float) -> np.ndarray:
    with rasterio.open(href) as source:
        native = source.width
    # 500 m products carry a built-in 1 km overview: a quarter of the download, and the
    # layers are stored at about 1 km anyway. Training and serving both use these files.
    level = {"overview_level": 0} if native == 2 * STORED else {}
    with rasterio.open(href, **level) as source:
        data = source.read(1).astype(np.float32)
        nodata = source.nodata
    bad = (data == nodata) | (data >= 32760) | ((data <= 0) if scale > 0.001 else (data < -2000))
    data = np.where(bad, np.nan, data * scale)
    if data.shape[0] == 2 * STORED:  # 500 m to about 1 km
        data = np.nanmean(data.reshape(STORED, 2, STORED, 2), axis=(1, 3))
    return data


def month_chunks(window: str) -> list[str]:
    """Split "start/end" into about one-month pieces: the catalogue times out on a whole
    season over all of India."""
    start, end = (pd.Timestamp(part) for part in window.split("/"))
    edges = list(pd.date_range(start, end, freq="MS")) + [end + pd.Timedelta(days=1)]
    edges = sorted({start, *edges})
    return [f"{a:%Y-%m-%d}/{(b - pd.Timedelta(days=1)):%Y-%m-%d}" for a, b in zip(edges, edges[1:]) if b > a]


def search_with_retry(catalog, collection: str, bbox: list, window: str, attempts: int = 6) -> list:
    for attempt in range(attempts):
        try:
            return list(catalog.search(collections=[collection], bbox=bbox, datetime=window).items())
        except Exception as error:  # upstream timeouts are common on the public catalogue
            wait = 10 * (attempt + 1)
            print("search retry", collection, window, type(error).__name__, f"wait {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"catalogue search kept failing for {collection} {window}")


def build_modis() -> None:
    import planetary_computer
    import pystac_client

    MODIS_DIR.mkdir(parents=True, exist_ok=True)
    catalog = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=planetary_computer.sign_inplace)
    tiles = modis_tiles()
    south, west, north, east = INDIA
    for name, (collection, asset, window, scale) in PRODUCTS.items():
        if all((MODIS_DIR / f"{name}_h{h:02d}v{v:02d}.npy").exists() for h, v in tiles):
            continue
        scenes: dict[tuple[int, int], list[str]] = {tile: [] for tile in tiles}
        for year in YEARS:
            items = []
            for chunk in month_chunks(window.format(y=year)):
                items += search_with_retry(catalog, collection, [west, south, east, north], chunk)
            # A composite that spans a month boundary is returned by both month searches.
            items = list({item.id: item for item in items}.values())
            terra = [item for item in items if item.id.startswith("MOD")] or items
            for item in terra:
                match = re.search(r"h(\d\d)v(\d\d)", item.id)
                tile = (int(match.group(1)), int(match.group(2)))
                if tile in scenes:
                    scenes[tile].append(item.assets[asset].href)
        for tile, hrefs in scenes.items():
            path = MODIS_DIR / f"{name}_h{tile[0]:02d}v{tile[1]:02d}.npy"
            if path.exists() or not hrefs:
                continue
            with ThreadPoolExecutor(int(os.getenv("BORESAKSHI_THREADS", "2"))) as pool:
                stack = np.stack(list(pool.map(lambda href: read_scene(href, scale), hrefs)))
            np.save(path, np.nanmedian(stack, axis=0).astype(np.float16))
            print(name, tile, len(hrefs), "scenes", flush=True)


def build_chirps() -> None:
    path = LAYER_DIR / "chirps.npz"
    if path.exists():
        return
    base = "/vsicurl/https://data.chc.ucsb.edu/products/CHIRPS/v3.0/annual/global/tifs/chirps-v3.0.{}.tif"
    south, west, north, east = INDIA
    years = []
    for year in range(2015, 2025):
        with rasterio.open(base.format(year)) as source:
            top, left = source.index(west, north)
            bottom, right = source.index(east, south)
            data = source.read(1, window=Window(left, top, right - left + 1, bottom - top + 1)).astype(np.float32)
            transform = source.window_transform(Window(left, top, right - left + 1, bottom - top + 1))
        data[data < 0] = np.nan
        years.append(data)
        print("chirps", year, flush=True)
    stack = np.stack(years)
    np.savez_compressed(path, mean=np.nanmean(stack, axis=0), cv=np.nanstd(stack, axis=0) / np.nanmean(stack, axis=0),
                        transform=np.array(transform)[:6])


def build_gsi() -> None:
    import gsi_layers
    for name in gsi_layers.LAYERS:
        gsi_layers.download(name, region=INDIA, path=LAYER_DIR / f"gsi_{name}_india.gpkg")
        print("gsi", name, flush=True)


class Layers:
    """Point lookups against the precomputed files."""

    def __init__(self) -> None:
        chirps = np.load(LAYER_DIR / "chirps.npz")
        self.rain_mean, self.rain_cv = chirps["mean"], chirps["cv"]
        a, b, c, d, e, f = chirps["transform"]
        self.rain_transform = rasterio.Affine(a, b, c, d, e, f)
        self.modis: dict[str, np.ndarray] = {}

    def _modis(self, name: str, h: int, v: int) -> np.ndarray | None:
        key = f"{name}_h{h:02d}v{v:02d}"
        if key not in self.modis:
            path = MODIS_DIR / f"{key}.npy"
            self.modis[key] = np.load(path, mmap_mode="r") if path.exists() else None
        return self.modis[key]

    def sample(self, lat: np.ndarray, lng: np.ndarray) -> pd.DataFrame:
        lat, lng = np.atleast_1d(lat).astype(float), np.atleast_1d(lng).astype(float)
        cols, rows = ~self.rain_transform * (lng, lat)
        rows = np.clip(np.floor(rows).astype(int), 0, self.rain_mean.shape[0] - 1)
        cols = np.clip(np.floor(cols).astype(int), 0, self.rain_mean.shape[1] - 1)
        table = pd.DataFrame({"rain_mean_mm": self.rain_mean[rows, cols], "rain_cv": self.rain_cv[rows, cols]})
        x, y = TO_SINUSOIDAL.transform(lng, lat)
        x, y = np.asarray(x), np.asarray(y)
        h = np.floor((x - ORIGIN_X) / TILE_M).astype(int)
        v = np.floor((ORIGIN_Y - y) / TILE_M).astype(int)
        pixel = TILE_M / STORED
        col = np.clip(np.floor((x - (ORIGIN_X + h * TILE_M)) / pixel).astype(int), 0, STORED - 1)
        row = np.clip(np.floor(((ORIGIN_Y - v * TILE_M) - y) / pixel).astype(int), 0, STORED - 1)
        for name in PRODUCTS:
            values = np.full(len(lat), np.nan)
            for tile in set(zip(h.tolist(), v.tolist())):
                grid = self._modis(name, *tile)
                if grid is None:
                    continue
                chosen = (h == tile[0]) & (v == tile[1])
                values[chosen] = grid[row[chosen], col[chosen]].astype(float)
            table[name] = values
        table["ndvi_seasonal_drop"] = table.ndvi_wet - table.ndvi_dry
        table["aridity_et_pet"] = table.et_mm / table.pet_mm
        return table


def sample_sites() -> None:
    sites = pd.read_csv(SITES)
    table = Layers().sample(sites.latitude.to_numpy(), sites.longitude.to_numpy())
    table.insert(0, "site", sites.site.to_numpy())
    table[["site", "rain_mean_mm", "rain_cv"]].to_csv(FEATURE_DIR / "climate.csv", index=False)
    table.drop(columns=["rain_mean_mm", "rain_cv"]).to_csv(FEATURE_DIR / "modis.csv", index=False)
    print(json.dumps({"sites": len(table), "missingPct": table.isna().mean().round(3).to_dict()}))


if __name__ == "__main__":
    command = sys.argv[1]
    LAYER_DIR.mkdir(parents=True, exist_ok=True)
    if command == "all":
        build_chirps()
        build_gsi()
        build_modis()
    elif command == "sample":
        sample_sites()
