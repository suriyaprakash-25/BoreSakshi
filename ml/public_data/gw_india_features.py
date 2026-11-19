"""Per-station features for the India groundwater table, computed by the live code.

  python gw_india_features.py gsi       geology, via gw_live.GeologyIndex
  python gw_india_features.py layers    rainfall and satellite, via india_layers

Using the serving code here guarantees a tapped location sees the same kind of values
the model was trained on. Terrain and land cover come from extract_features, which the
live service also calls.
"""
from __future__ import annotations

import os
import sys
import time

os.environ.setdefault("BORESAKSHI_SITE_SET", "stations")

import pandas as pd  # noqa: E402

from config import FEATURE_DIR, SITES  # noqa: E402


def gsi() -> None:
    from gw_live import GeologyIndex

    sites = pd.read_csv(SITES)
    index = GeologyIndex()
    rows, unmapped, started = [], 0, time.time()
    for count, site in enumerate(sites.itertuples(), 1):
        row = {"site": int(site.site), **index.features(site.latitude, site.longitude)}
        unmapped += row["gsi_unit"] == "unmapped"  # holes in the GSI layer; the live code does the same
        rows.append(row)
        if count % 2000 == 0:
            print("gsi", count, "of", len(sites), f"{time.time() - started:.0f}s unmapped={unmapped}", flush=True)
    pd.DataFrame(rows).to_csv(FEATURE_DIR / "gsi.csv", index=False)
    print("gsi rows", len(rows), "unmapped", unmapped)


def layers() -> None:
    import india_layers
    india_layers.sample_sites()


if __name__ == "__main__":
    {"gsi": gsi, "layers": layers}[sys.argv[1]]()
