from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "public_data"))

from build_wells import inside_excluded_box, rock_family  # noqa: E402


def test_pilot_box_readings_are_identified_for_exclusion():
    frame = pd.DataFrame({"latitude": [11.36, 12.5, 10.94], "longitude": [77.8, 77.8, 77.8]})
    assert inside_excluded_box(frame).tolist() == [True, False, False]


def test_rock_families_cover_common_public_labels():
    labels = pd.Series(["Biotite Granite Gneiss", "Chamockite", "Pink Granite", "Schist", "Unknown"])
    assert rock_family(labels).tolist() == ["gneiss", "charnockite", "granite", "schist", "other"]
