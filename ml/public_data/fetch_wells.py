"""Download the public litholog layer. Its licence is unconfirmed, so the raw file
stays in the git-ignored data directory and must not be redistributed."""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request

from config import DATA_DIR, EXCLUDED_BOX, RAW_WELLS

URL = "https://livingatlas.esri.in/server/rest/services/India/Lithilog/MapServer/0/query"
PAGE = 2000


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    while True:
        query = urllib.parse.urlencode({
            "where": "1=1", "outFields": "*", "returnGeometry": "false", "orderByFields": "objectid",
            "resultOffset": len(rows), "resultRecordCount": PAGE, "f": "json",
        })
        with urllib.request.urlopen(f"{URL}?{query}", timeout=90) as response:
            batch = [feature["attributes"] for feature in json.load(response).get("features", [])]
        rows += batch
        if len(batch) < PAGE:
            break
        time.sleep(0.5)
    # Readings inside the pilot box are never saved, on the project owner's instruction.
    south, west, north, east = EXCLUDED_BOX
    kept = [row for row in rows if not (south <= row["latitude"] <= north and west <= row["longitude"] <= east)]
    RAW_WELLS.write_text(json.dumps(kept), encoding="utf-8")
    print(f"saved {len(kept)} wells to {RAW_WELLS}; dropped {len(rows) - len(kept)} pilot-box readings")


if __name__ == "__main__":
    main()
