from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from .schema import ALL_FEATURES, FEATURE_SCHEMA_VERSION


DYNAMIC_LAYER_KINDS = {
    "rainfallAnnual",
    "rainfallSeasonal",
    "rainfallRecent",
    "rainfallNormal",
    "rainfallAnomaly",
    "ndvi",
    "ndwi",
    "landUse",
}

SUPPORTED_LAYER_KINDS = {
    "dem",
    "flowAccumulation",
    "drainage",
    "watershed",
    "geology",
    "lineaments",
    "rainfallAnnual",
    "rainfallSeasonal",
    "rainfallRecent",
    "rainfallNormal",
    "rainfallAnomaly",
    "ndvi",
    "ndwi",
    "landUse",
    "soil",
}


class FeatureManifestError(ValueError):
    pass


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _round(value: float | None, digits: int = 6) -> float | None:
    return None if value is None else round(float(value), digits)


def parse_ascii_grid(text: str) -> dict[str, Any]:
    if not text.strip():
        raise FeatureManifestError("ASCII grid is empty")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    header: dict[str, float] = {}
    data_start = 0
    keys = {"ncols", "nrows", "xllcorner", "xllcenter", "yllcorner", "yllcenter", "cellsize", "nodata_value"}
    for index, line in enumerate(lines[:12]):
        parts = line.split()
        key = parts[0].lower() if parts else ""
        if key not in keys:
            break
        if len(parts) < 2:
            raise FeatureManifestError(f"invalid ASCII grid header line: {line}")
        header[key] = float(parts[1])
        data_start = index + 1
    for key in ("ncols", "nrows", "cellsize"):
        if key not in header or not math.isfinite(header[key]) or header[key] <= 0:
            raise FeatureManifestError(f"ASCII grid missing/invalid {key}")
    if "xllcorner" not in header and "xllcenter" not in header:
        raise FeatureManifestError("ASCII grid missing xllcorner/xllcenter")
    if "yllcorner" not in header and "yllcenter" not in header:
        raise FeatureManifestError("ASCII grid missing yllcorner/yllcenter")

    ncols, nrows = int(header["ncols"]), int(header["nrows"])
    cellsize = float(header["cellsize"])
    xllcorner = header.get("xllcorner", header["xllcenter"] - cellsize / 2)
    yllcorner = header.get("yllcorner", header["yllcenter"] - cellsize / 2)
    rows = [[float(value) for value in line.split()] for line in lines[data_start:]]
    if len(rows) != nrows or any(len(row) != ncols for row in rows):
        raise FeatureManifestError("ASCII grid data shape does not match header")
    if any(not math.isfinite(value) for row in rows for value in row):
        raise FeatureManifestError("ASCII grid contains non-finite values")
    return {
        "format": "esri_ascii",
        "ncols": ncols,
        "nrows": nrows,
        "xllcorner": float(xllcorner),
        "yllcorner": float(yllcorner),
        "cellsize": cellsize,
        "nodata": float(header.get("nodata_value", -9999)),
        "data": rows,
    }


def _raster_position(raster: dict[str, Any], lat: float, lng: float) -> tuple[float, float]:
    col = (lng - (raster["xllcorner"] + raster["cellsize"] / 2)) / raster["cellsize"]
    row_from_bottom = (lat - (raster["yllcorner"] + raster["cellsize"] / 2)) / raster["cellsize"]
    row = raster["nrows"] - 1 - row_from_bottom
    return row, col


def _raster_value(raster: dict[str, Any], row: int, col: int) -> float | None:
    if row < 0 or row >= raster["nrows"] or col < 0 or col >= raster["ncols"]:
        return None
    value = raster["data"][row][col]
    return None if value == raster["nodata"] else float(value)


def sample_raster(raster: dict[str, Any], lat: float, lng: float, *, nearest: bool = False, category_map: dict[str, Any] | None = None) -> Any:
    row, col = _raster_position(raster, lat, lng)
    if nearest or category_map:
        sampled = _raster_value(raster, round(row), round(col))
    else:
        r0, r1, c0, c1 = math.floor(row), math.ceil(row), math.floor(col), math.ceil(col)
        points = [
            (r0, c0, (1 - (row - r0)) * (1 - (col - c0))),
            (r0, c1, (1 - (row - r0)) * (col - c0)),
            (r1, c0, (row - r0) * (1 - (col - c0))),
            (r1, c1, (row - r0) * (col - c0)),
        ]
        weighted = 0.0
        weight = 0.0
        for r, c, w in points:
            value = _raster_value(raster, r, c)
            if value is not None and w > 0:
                weighted += value * w
                weight += w
        sampled = weighted / weight if weight else None
    if sampled is None:
        return None
    if category_map:
        key = str(int(round(sampled)))
        return category_map.get(key, category_map.get(int(key), key))
    return _round(float(sampled), 6)


def _meters_per_degree(lat: float) -> tuple[float, float]:
    return 111320 * max(0.01, math.cos(math.radians(lat))), 110540


def terrain_derivatives(raster: dict[str, Any], lat: float, lng: float) -> dict[str, float | None]:
    row, col = _raster_position(raster, lat, lng)
    r, c = round(row), round(col)
    z = [[_raster_value(raster, r + dr, c + dc) for dc in (-1, 0, 1)] for dr in (-1, 0, 1)]
    if any(value is None for line in z for value in line):
        return {"slopeDeg": None, "aspectDeg": None, "curvature": None}
    dx_scale, dy_scale = _meters_per_degree(lat)
    dx, dy = raster["cellsize"] * dx_scale, raster["cellsize"] * dy_scale
    dzdx = ((z[0][2] + 2 * z[1][2] + z[2][2]) - (z[0][0] + 2 * z[1][0] + z[2][0])) / (8 * dx)
    dzdy = ((z[0][0] + 2 * z[0][1] + z[0][2]) - (z[2][0] + 2 * z[2][1] + z[2][2])) / (8 * dy)
    slope = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    aspect = math.degrees(math.atan2(dzdx, dzdy)) % 360
    avg_cell = (dx + dy) / 2
    curvature = (z[0][1] + z[2][1] + z[1][0] + z[1][2] - 4 * z[1][1]) / (avg_cell**2)
    return {"slopeDeg": _round(slope, 4), "aspectDeg": _round(aspect, 4), "curvature": _round(curvature, 10)}


def _point_in_ring(lng: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        intersects = ((yi > lat) != (yj > lat)) and (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) or np.finfo(float).eps) + xi)
        if intersects:
            inside = not inside
        j = i
    return inside


def _point_in_polygon(lng: float, lat: float, polygon: list[list[list[float]]]) -> bool:
    if not polygon or not _point_in_ring(lng, lat, polygon[0]):
        return False
    return not any(_point_in_ring(lng, lat, hole) for hole in polygon[1:])


def containing_feature(lat: float, lng: float, geojson: dict[str, Any]) -> dict[str, Any] | None:
    if geojson.get("type") == "FeatureCollection":
        features = geojson.get("features", [])
    elif geojson.get("type") == "Feature":
        features = [geojson]
    else:
        features = []
    for feature in features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") == "Polygon" and _point_in_polygon(lng, lat, geometry.get("coordinates", [])):
            return feature
        if geometry.get("type") == "MultiPolygon" and any(_point_in_polygon(lng, lat, polygon) for polygon in geometry.get("coordinates", [])):
            return feature
    return None


def _line_strings(geojson: dict[str, Any]) -> list[list[list[float]]]:
    lines: list[list[list[float]]] = []

    def visit(geometry: dict[str, Any] | None) -> None:
        if not geometry:
            return
        kind = geometry.get("type")
        if kind == "LineString":
            lines.append(geometry.get("coordinates", []))
        elif kind == "MultiLineString":
            lines.extend(geometry.get("coordinates", []))
        elif kind == "GeometryCollection":
            for child in geometry.get("geometries", []):
                visit(child)

    if geojson.get("type") == "FeatureCollection":
        for feature in geojson.get("features", []):
            visit(feature.get("geometry"))
    elif geojson.get("type") == "Feature":
        visit(geojson.get("geometry"))
    else:
        visit(geojson)
    return lines


def _local_meters(coord: list[float], lat: float, lng: float) -> tuple[float, float]:
    scale_x, scale_y = _meters_per_degree(lat)
    return (coord[0] - lng) * scale_x, (coord[1] - lat) * scale_y


def _segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def distance_to_lines_m(lat: float, lng: float, geojson: dict[str, Any]) -> float | None:
    minimum = math.inf
    for line in _line_strings(geojson):
        for index in range(len(line) - 1):
            ax, ay = _local_meters(line[index], lat, lng)
            bx, by = _local_meters(line[index + 1], lat, lng)
            minimum = min(minimum, _segment_distance(0.0, 0.0, ax, ay, bx, by))
    return _round(minimum, 2) if math.isfinite(minimum) else None


def _segment_length_inside_circle(a: tuple[float, float], b: tuple[float, float], radius: float) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    if not length:
        return 0.0
    A = dx * dx + dy * dy
    B = 2 * (ax * dx + ay * dy)
    C = ax * ax + ay * ay - radius * radius
    disc = B * B - 4 * A * C
    roots: list[float] = []
    if disc >= 0:
        root = math.sqrt(disc)
        roots.extend(((-B - root) / (2 * A), (-B + root) / (2 * A)))
    cuts = sorted([0.0, 1.0, *[t for t in roots if 0 < t < 1]])
    inside = 0.0
    for left, right in zip(cuts, cuts[1:]):
        mid = (left + right) / 2
        x, y = ax + mid * dx, ay + mid * dy
        if x * x + y * y <= radius * radius:
            inside += (right - left) * length
    return inside


def line_density(lat: float, lng: float, geojson: dict[str, Any], radius_km: float = 2.0) -> float:
    radius_m = radius_km * 1000
    total_m = 0.0
    for line in _line_strings(geojson):
        for index in range(len(line) - 1):
            total_m += _segment_length_inside_circle(
                _local_meters(line[index], lat, lng),
                _local_meters(line[index + 1], lat, lng),
                radius_m,
            )
    return _round((total_m / 1000) / (math.pi * radius_km * radius_km), 6) or 0.0


def haversine_km(a: dict[str, float], b: dict[str, float]) -> float:
    earth = 6371.0
    dlat = math.radians(b["lat"] - a["lat"])
    dlng = math.radians(b["lng"] - a["lng"])
    la1, la2 = math.radians(a["lat"]), math.radians(b["lat"])
    h = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlng / 2) ** 2
    return 2 * earth * math.asin(math.sqrt(h))


@dataclass(frozen=True)
class LoadedLayer:
    meta: dict[str, Any]
    data: dict[str, Any]


class FeatureExtractor:
    def __init__(self, manifest_path: str | Path, *, nearby_radius_km: float = 5.0, density_radius_km: float = 2.0):
        self.manifest_path = Path(manifest_path).resolve()
        self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.dataset_version = str(self.manifest.get("datasetVersion") or "").strip()
        if not self.dataset_version:
            raise FeatureManifestError("feature manifest datasetVersion is required")
        raw_layers = self.manifest.get("layers")
        if not isinstance(raw_layers, list) or not raw_layers:
            raise FeatureManifestError("feature manifest layers must be a non-empty array")
        self.nearby_radius_km = float(self.manifest.get("parameters", {}).get("nearbyRadiusKm", nearby_radius_km))
        self.density_radius_km = float(self.manifest.get("parameters", {}).get("densityRadiusKm", density_radius_km))
        self.layers: list[LoadedLayer] = []
        seen: set[str] = set()
        for layer in raw_layers:
            layer_id = str(layer.get("id") or "").strip()
            kind = layer.get("kind")
            fmt = layer.get("format")
            if not layer_id or layer_id in seen:
                raise FeatureManifestError("feature manifest layer IDs must be non-empty and unique")
            seen.add(layer_id)
            if kind not in SUPPORTED_LAYER_KINDS:
                raise FeatureManifestError(f"unsupported feature layer kind: {kind}")
            if fmt not in {"esri_ascii", "geojson"}:
                raise FeatureManifestError(f"unsupported feature layer format: {fmt}")
            if kind in DYNAMIC_LAYER_KINDS and _parse_time(layer.get("observedAt")) is None:
                raise FeatureManifestError(f"dynamic layer {layer_id} requires observedAt")
            source_path = (self.manifest_path.parent / str(layer.get("path") or "")).resolve()
            if not source_path.exists():
                raise FeatureManifestError(f"feature source missing: {source_path}")
            expected_sha = str(layer.get("sha256") or "").lower()
            actual_sha = _sha256_file(source_path)
            if len(expected_sha) != 64 or actual_sha != expected_sha:
                raise FeatureManifestError(f"feature source checksum mismatch: {layer_id}")
            text = source_path.read_text(encoding="utf-8")
            data = parse_ascii_grid(text) if fmt == "esri_ascii" else json.loads(text)
            self.layers.append(LoadedLayer({**layer, "sha256": actual_sha}, data))
        self.manifest_sha256 = _sha256_file(self.manifest_path)
        self.feature_version = f"{self.dataset_version}:features-{FEATURE_SCHEMA_VERSION}"

    def _select(self, kind: str, as_of: datetime) -> LoadedLayer | None:
        candidates = [layer for layer in self.layers if layer.meta.get("kind") == kind]
        if not candidates:
            return None
        if kind not in DYNAMIC_LAYER_KINDS:
            return candidates[0]
        eligible = [layer for layer in candidates if (_parse_time(layer.meta.get("observedAt")) or datetime.max.replace(tzinfo=timezone.utc)) <= as_of]
        if not eligible:
            return None
        return max(eligible, key=lambda layer: _parse_time(layer.meta.get("observedAt")) or datetime.min.replace(tzinfo=timezone.utc))

    def _layer_value(self, layer: LoadedLayer | None, lat: float, lng: float, *, property_name: str | None = None) -> Any:
        if layer is None:
            return None
        if layer.meta["format"] == "esri_ascii":
            category_map = layer.meta.get("categoryMap")
            return sample_raster(layer.data, lat, lng, nearest=bool(category_map), category_map=category_map)
        feature = containing_feature(lat, lng, layer.data)
        if not feature:
            return None
        prop = property_name or layer.meta.get("property")
        return feature.get("properties", {}).get(prop) if prop else feature.get("properties")

    def _nearby(self, lat: float, lng: float, as_of: datetime, wells: list[dict[str, Any]]) -> dict[str, Any]:
        candidates: list[dict[str, Any]] = []
        for well in wells:
            if well.get("verified") is not True or well.get("flagged") is True:
                continue
            eligibility = well.get("datasetEligibility")
            if isinstance(eligibility, dict) and eligibility.get("eligible") is False:
                continue
            try:
                wlat, wlng = float(well["lat"]), float(well["lng"])
            except (KeyError, TypeError, ValueError):
                continue
            event_time = _parse_time(well.get("drilledAt") or well.get("createdAt"))
            if event_time is None or event_time >= as_of:
                continue
            distance = haversine_km({"lat": lat, "lng": lng}, {"lat": wlat, "lng": wlng})
            if distance <= self.nearby_radius_km:
                candidates.append({**well, "distanceKm": distance})
        candidates.sort(key=lambda item: item["distanceKm"])
        successes = [well for well in candidates if well.get("success") is True]
        failures = [well for well in candidates if well.get("success") is False]
        labelled = len(successes) + len(failures)
        depths = [float(well["depthFt"]) for well in candidates if isinstance(well.get("depthFt"), (int, float)) and math.isfinite(float(well["depthFt"]))]
        yields = [float(well["yieldLpm"]) for well in candidates if isinstance(well.get("yieldLpm"), (int, float)) and math.isfinite(float(well["yieldLpm"]))]
        return {
            "nearbyNearestDistanceKm": _round(candidates[0]["distanceKm"], 4) if candidates else None,
            "nearbyCount": len(candidates),
            "nearbySuccessRate": _round(len(successes) / labelled, 6) if labelled else None,
            "nearbyFailureRate": _round(len(failures) / labelled, 6) if labelled else None,
            "nearbyAverageDepthFt": _round(float(np.mean(depths)), 3) if depths else None,
            "nearbyAverageYieldLpm": _round(float(np.mean(yields)), 3) if yields else None,
            "successCount": len(successes),
            "failCount": len(failures),
            "latestNearbyLogAt": max((str(well.get("drilledAt") or well.get("createdAt")) for well in candidates), default=None),
        }

    def extract(self, lat: float, lng: float, nearby_borewells: list[dict[str, Any]], *, as_of: datetime | None = None) -> dict[str, Any]:
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError("valid lat/lng are required")
        as_of = (as_of or datetime.now(timezone.utc)).astimezone(timezone.utc)
        features = {name: None for name in ALL_FEATURES}
        trace: dict[str, Any] = {}

        dem = self._select("dem", as_of)
        if dem:
            features["terrainElevationM"] = self._layer_value(dem, lat, lng)
            terrain = terrain_derivatives(dem.data, lat, lng)
            features["terrainSlopeDeg"] = terrain["slopeDeg"]
            features["terrainAspectDeg"] = terrain["aspectDeg"]
            features["terrainCurvature"] = terrain["curvature"]
            for name in ("terrainElevationM", "terrainSlopeDeg", "terrainAspectDeg", "terrainCurvature"):
                trace[name] = dem.meta["id"]

        drainage = self._select("drainage", as_of)
        if drainage:
            features["hydrologyDistanceToDrainageM"] = distance_to_lines_m(lat, lng, drainage.data)
            features["hydrologyDrainageDensityKmPerKm2"] = line_density(lat, lng, drainage.data, self.density_radius_km)
            trace["hydrologyDistanceToDrainageM"] = drainage.meta["id"]
            trace["hydrologyDrainageDensityKmPerKm2"] = drainage.meta["id"]

        watershed = self._select("watershed", as_of)
        if watershed:
            features["hydrologyWatershedId"] = self._layer_value(watershed, lat, lng, property_name=watershed.meta.get("property", "watershedId"))
            trace["hydrologyWatershedId"] = watershed.meta["id"]

        flow = self._select("flowAccumulation", as_of)
        if flow:
            features["hydrologyFlowAccumulation"] = self._layer_value(flow, lat, lng)
            trace["hydrologyFlowAccumulation"] = flow.meta["id"]

        geology = self._select("geology", as_of)
        if geology:
            feature = containing_feature(lat, lng, geology.data)
            props = feature.get("properties", {}) if feature else {}
            features["geologyFormation"] = props.get(geology.meta.get("formationProperty", "formation"))
            features["geologyLithology"] = props.get(geology.meta.get("lithologyProperty", "lithology"))
            trace["geologyFormation"] = geology.meta["id"]
            trace["geologyLithology"] = geology.meta["id"]

        lineaments = self._select("lineaments", as_of)
        if lineaments:
            distance = distance_to_lines_m(lat, lng, lineaments.data)
            features["geologyDistanceToLineamentM"] = distance
            features["geologyLineamentDensityKmPerKm2"] = line_density(lat, lng, lineaments.data, self.density_radius_km)
            features["geologyFractureProximityScore"] = _round(math.exp(-distance / 1000), 6) if distance is not None else None
            for name in ("geologyDistanceToLineamentM", "geologyLineamentDensityKmPerKm2", "geologyFractureProximityScore"):
                trace[name] = lineaments.meta["id"]

        mappings = {
            "rainfallAnnual": "climateAnnualRainfallMm",
            "rainfallSeasonal": "climateSeasonalRainfallMm",
            "rainfallRecent": "climateRecentRainfallMm",
            "ndvi": "satelliteNdvi",
            "ndwi": "satelliteNdwi",
        }
        for kind, feature_name in mappings.items():
            layer = self._select(kind, as_of)
            if layer:
                features[feature_name] = self._layer_value(layer, lat, lng)
                trace[feature_name] = layer.meta["id"]

        anomaly = self._select("rainfallAnomaly", as_of)
        annual = self._select("rainfallAnnual", as_of)
        normal = self._select("rainfallNormal", as_of)
        if anomaly:
            features["climateRainfallAnomalyPct"] = self._layer_value(anomaly, lat, lng)
            trace["climateRainfallAnomalyPct"] = anomaly.meta["id"]
        elif annual and normal:
            annual_value = self._layer_value(annual, lat, lng)
            normal_value = self._layer_value(normal, lat, lng)
            if isinstance(annual_value, (int, float)) and isinstance(normal_value, (int, float)) and normal_value != 0:
                features["climateRainfallAnomalyPct"] = _round(((annual_value - normal_value) / normal_value) * 100, 4)
                trace["climateRainfallAnomalyPct"] = [annual.meta["id"], normal.meta["id"]]

        land_use = self._select("landUse", as_of)
        if land_use:
            features["satelliteLandUseClass"] = self._layer_value(land_use, lat, lng, property_name=land_use.meta.get("property", "class"))
            trace["satelliteLandUseClass"] = land_use.meta["id"]

        nearby = self._nearby(lat, lng, as_of, nearby_borewells)
        for name in ("nearbyNearestDistanceKm", "nearbyCount", "nearbySuccessRate", "nearbyFailureRate", "nearbyAverageDepthFt", "nearbyAverageYieldLpm"):
            features[name] = nearby[name]
            trace[name] = "verified_borewells"

        available = [name for name, value in features.items() if value is not None and value != ""]
        missing = [name for name in ALL_FEATURES if name not in available]
        coverage_pct = round(100 * len(available) / len(ALL_FEATURES), 2)
        return {
            "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
            "featureVersion": self.feature_version,
            "features": features,
            "coverage": {
                "availableCount": len(available),
                "requiredCount": len(ALL_FEATURES),
                "coveragePct": coverage_pct,
                "missingFeatures": missing,
            },
            "sourceTrace": trace,
            "nearbySummary": nearby,
            "asOf": as_of.isoformat().replace("+00:00", "Z"),
        }
