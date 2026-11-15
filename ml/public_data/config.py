"""Shared settings for the public-data helper pipeline.

Public wells train helper models only. They never enter `borewells`, never reach
the serving bundle, and never count as verified evidence.
"""
from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.getenv("BORESAKSHI_PUBLIC_DATA_DIR", Path(__file__).resolve().parent.parent / "data_public"))
RAW_WELLS = DATA_DIR / "wells_raw.json"
WELLS = DATA_DIR / "wells_clean.csv"
AUDIT = DATA_DIR / "wells_audit.json"
RESULTS = DATA_DIR / "helper_results.json"

# Feature scripts run against one site set: "wells" (public well logs) or "stations"
# (groundwater monitoring stations). Set BORESAKSHI_SITE_SET to choose.
SITE_SET = os.getenv("BORESAKSHI_SITE_SET", "wells")
GW_STATIONS = DATA_DIR / "gw_stations.csv"
GW_EVIDENCE = DATA_DIR / "gw_evidence.csv"
GW_DUG_WELLS = DATA_DIR / "gw_dug_wells.csv"
AUDIT_GW = DATA_DIR / "gw_audit.json"
GW_RESULTS = DATA_DIR / "gw_results.json"
GW_MODEL_DIR = DATA_DIR / "gw_model"
GW_GRID = DATA_DIR / "gw_grid.csv"
GW_MAP = DATA_DIR / "gw_pilot_map.csv"
SITES = {"stations": GW_STATIONS, "grid": GW_GRID}.get(SITE_SET, DATA_DIR / "sites.csv")
FEATURE_DIR = DATA_DIR / {"stations": "features_gw", "grid": "features_grid"}.get(SITE_SET, "features")

# Peninsular India: south, west, north, east. Readings from GW_SINCE describe today's
# water table.
GW_REGION = (8.0, 72.0, 22.0, 88.0)
GW_SINCE = 2015
MODEL_DIR = DATA_DIR / "helper_models"

# Readings inside the pilot box are excluded on the project owner's instruction.
# This is the same "south,west,north,east" box the API uses for PILOT_BBOX.
EXCLUDED_BOX = (10.95, 77.45, 11.70, 78.55)

BLOCK_DEG = 0.5
SITE_RADIUS_M = 150
MAX_DISCHARGE = 100.0
MAX_BEDROCK_M = 100.0
