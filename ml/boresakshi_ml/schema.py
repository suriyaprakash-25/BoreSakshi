MODEL_SCHEMA_VERSION = "1.0.0"
FEATURE_SCHEMA_VERSION = "1.0.0"

NUMERIC_FEATURES = [
    "terrainElevationM",
    "terrainSlopeDeg",
    "terrainAspectDeg",
    "terrainCurvature",
    "hydrologyDistanceToDrainageM",
    "hydrologyDrainageDensityKmPerKm2",
    "hydrologyFlowAccumulation",
    "geologyLineamentDensityKmPerKm2",
    "geologyDistanceToLineamentM",
    "geologyFractureProximityScore",
    "climateAnnualRainfallMm",
    "climateSeasonalRainfallMm",
    "climateRecentRainfallMm",
    "climateRainfallAnomalyPct",
    "satelliteNdvi",
    "satelliteNdwi",
    "nearbyNearestDistanceKm",
    "nearbyCount",
    "nearbySuccessRate",
    "nearbyFailureRate",
    "nearbyAverageDepthFt",
    "nearbyAverageYieldLpm",
]

CATEGORICAL_FEATURES = [
    "hydrologyWatershedId",
    "geologyFormation",
    "geologyLithology",
    "satelliteLandUseClass",
]

ALL_FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

TASKS = {
    "success": {
        "kind": "classification",
        "label": "success",
        "output": "successProbability",
    },
    "depth": {
        "kind": "regression",
        "label": "waterStrikeFt",
        "output": "estimatedWaterStrikeFt",
    },
    "yield": {
        "kind": "regression",
        "label": "yieldLpm",
        "output": "estimatedYieldLpm",
    },
}
