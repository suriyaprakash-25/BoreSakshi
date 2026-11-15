"""Sample MODIS vegetation, evapotranspiration and heat, plus JRC surface-water history.

Whole MODIS tiles are read once per date and sampled in bulk, which is far quicker
than point queries. Dry-season greenness and heat hint at shallow water that plants
can reach; open water history marks tanks and rivers that feed recharge.
"""
from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import planetary_computer
import pystac_client
import rasterio
from pyproj import Transformer

from config import FEATURE_DIR, GW_REGION, SITE_SET, SITES

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")

SINUSOIDAL = "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs"
TILE_SIZE_M = 1111950.5197665
TO_SINUSOIDAL = Transformer.from_crs("EPSG:4326", SINUSOIDAL, always_xy=True)
YEARS = [2022, 2023, 2024]
READERS = 8

PRODUCTS = {
    "ndvi_dry": ("modis-13A1-061", "500m_16_days_NDVI", ["{y}-03-01/{y}-05-15"], 0.0001),
    "ndvi_wet": ("modis-13A1-061", "500m_16_days_NDVI", ["{y}-10-01/{y}-12-15"], 0.0001),
    "lst_dry_k": ("modis-11A2-061", "LST_Day_1km", ["{y}-03-15/{y}-05-15"], 0.02),
    "et_mm": ("modis-16A3GF-061", "ET_500m", ["{y}-01-01/{y}-01-31"], 0.1),
    "pet_mm": ("modis-16A3GF-061", "PET_500m", ["{y}-01-01/{y}-01-31"], 0.1),
}


def tile_index(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return np.floor((x + 18 * TILE_SIZE_M) / TILE_SIZE_M).astype(int), np.floor((9 * TILE_SIZE_M - y) / TILE_SIZE_M).astype(int)


def sample_item(href: str, h: int, v: int, x: np.ndarray, y: np.ndarray, tile_h: np.ndarray, tile_v: np.ndarray, scale: float, count: int) -> np.ndarray:
    out = np.full(count, np.nan)
    chosen = np.flatnonzero((tile_h == h) & (tile_v == v))
    with rasterio.open(href) as source:
        data = source.read(1).astype(float)
        rows, cols = rasterio.transform.rowcol(source.transform, x[chosen], y[chosen])
        nodata = source.nodata
    rows, cols = np.clip(rows, 0, data.shape[0] - 1), np.clip(cols, 0, data.shape[1] - 1)
    values = data[rows, cols]
    bad = (values == nodata) | (values <= 0 if scale > 0.001 else values < -2000) | (values >= 32760)
    out[chosen] = np.where(bad, np.nan, values * scale)
    return out


def modis_table(sites: pd.DataFrame) -> pd.DataFrame:
    catalog = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=planetary_computer.sign_inplace)
    x, y = TO_SINUSOIDAL.transform(sites.longitude.to_numpy(), sites.latitude.to_numpy())
    x, y = np.asarray(x), np.asarray(y)
    tile_h, tile_v = tile_index(x, y)
    south, west, north, east = GW_REGION
    result = pd.DataFrame({"site": sites.site})
    for name, (collection, asset, windows, scale) in PRODUCTS.items():
        jobs = []
        for year in YEARS:
            items = list(catalog.search(collections=[collection], bbox=[west, south, east, north],
                                        datetime=windows[0].format(y=year)).items())
            # Terra alone gives enough dates. Aqua would double the reads for little gain.
            terra = [item for item in items if item.id.startswith("MOD")]
            for item in terra or items:
                match = re.search(r"h(\d\d)v(\d\d)", item.id)
                h, v = int(match.group(1)), int(match.group(2))
                if ((tile_h == h) & (tile_v == v)).any():
                    jobs.append((item.assets[asset].href, h, v))
        print(name, len(jobs), "tiles to read", flush=True)
        with ThreadPoolExecutor(READERS) as pool:
            layers = list(pool.map(lambda job: sample_item(*job, x, y, tile_h, tile_v, scale, len(sites)), jobs))
        result[name] = np.nanmedian(np.stack(layers), axis=0)
        print(name, len(layers), "layers", f"missing {result[name].isna().mean():.1%}", flush=True)
    result["ndvi_seasonal_drop"] = result.ndvi_wet - result.ndvi_dry
    result["aridity_et_pet"] = result.et_mm / result.pet_mm
    return result


def jrc_table(sites: pd.DataFrame) -> pd.DataFrame:
    """Share of years with surface water, within about 1 km, and distance to the nearest."""
    base = "/vsicurl/https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_{}E_{}Nv1_4_2021.tif"
    occurrence, distance = np.full(len(sites), np.nan), np.full(len(sites), np.nan)
    west_index = (np.floor(sites.longitude / 10) * 10).astype(int).to_numpy()
    north_index = (np.ceil(sites.latitude / 10) * 10).astype(int).to_numpy()
    for west, north in sorted(set(zip(west_index, north_index))):
        chosen = np.flatnonzero((west_index == west) & (north_index == north))
        with rasterio.open(base.format(west, north)) as source:
            # The overview (about 240 m) is enough for tanks and rivers at this scale.
            factor = 8
            data = source.read(1, out_shape=(source.height // factor, source.width // factor), resampling=rasterio.enums.Resampling.average).astype(float)
            rows, cols = rasterio.transform.rowcol(source.transform, sites.longitude.to_numpy()[chosen], sites.latitude.to_numpy()[chosen])
        data[data > 100] = 0
        rows, cols = np.asarray(rows) // factor, np.asarray(cols) // factor
        from scipy import ndimage
        wet = data >= 5
        away = ndimage.distance_transform_edt(~wet) * 0.24
        local = ndimage.uniform_filter(data, 9)
        rows, cols = np.clip(rows, 0, data.shape[0] - 1), np.clip(cols, 0, data.shape[1] - 1)
        occurrence[chosen], distance[chosen] = local[rows, cols], away[rows, cols]
        print("jrc", west, north, len(chosen), flush=True)
    return pd.DataFrame({"site": sites.site, "jrc_occurrence_1km": occurrence, "jrc_water_km": distance})


def main() -> None:
    sites = pd.read_csv(SITES)
    # The final models rejected the surface-water group, so the map doesn't need it.
    if SITE_SET != "grid" and not (FEATURE_DIR / "jrc.csv").exists():
        jrc_table(sites).to_csv(FEATURE_DIR / "jrc.csv", index=False)
    modis_table(sites).to_csv(FEATURE_DIR / "modis.csv", index=False)


if __name__ == "__main__":
    main()
