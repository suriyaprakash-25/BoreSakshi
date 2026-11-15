from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "public_data"))

pytest.importorskip("lightgbm")

from retrain_with_field_data import MIN_DRY_HOLES, MIN_RECORDS, gate_failures, read_records  # noqa: E402


def write(tmp_path, rows):
    path = tmp_path / "field.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def test_outcomes_become_labels_and_grades_set_weights(tmp_path):
    records = read_records(write(tmp_path, [
        {"latitude": 11.36, "longitude": 77.8, "drilled_date": "2027-01-10", "outcome": "Water", "grade": "G1"},
        {"latitude": 11.37, "longitude": 77.8, "drilled_date": "2027-01-11", "outcome": " dry ", "grade": "g3"},
    ]))
    assert records.water.tolist() == [1, 0]
    assert records.weight.tolist() == [1.0, 0.4]


def test_unclear_outcome_is_refused_rather_than_guessed(tmp_path):
    with pytest.raises(SystemExit, match="must be 'water' or 'dry'"):
        read_records(write(tmp_path, [{"latitude": 11.36, "longitude": 77.8, "drilled_date": "2027-01-10", "outcome": "maybe"}]))


def test_missing_column_is_named(tmp_path):
    with pytest.raises(SystemExit, match="drilled_date"):
        read_records(write(tmp_path, [{"latitude": 11.36, "longitude": 77.8, "outcome": "dry"}]))


def test_gates_block_too_few_records_and_dry_holes():
    small = pd.DataFrame({"water": [1, 0], "block": ["a", "b"]})
    failures = " ".join(gate_failures(small))
    assert "records" in failures and "dry holes" in failures and "areas" in failures


def test_gates_pass_at_the_minimums():
    rows = MIN_RECORDS
    enough = pd.DataFrame({
        "water": [0] * MIN_DRY_HOLES + [1] * (rows - MIN_DRY_HOLES),
        "block": [f"b{index % 20}" for index in range(rows)],
    })
    assert gate_failures(enough) == []
