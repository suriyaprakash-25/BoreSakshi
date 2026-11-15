MODEL_SCHEMA_VERSION = "1.0.0"
FEATURE_SCHEMA_VERSION = "1.0.0"

NUMERIC_FEATURES = [
    # Topographic & DEM features
    "terrainElevationM",
    "terrainSlopeDeg",
    "terrainAspectDeg",
    "terrainCurvature",
    "terrainHandM",
    "terrainTwi",

    # Hydrology & drainage network
    "hydrologyDistanceToDrainageM",
    "hydrologyDrainageDensityKmPerKm2",
    "hydrologyFlowAccumulation",

    # Geological fracture network & structural lineaments
    "geologyLineamentDensityKmPerKm2",
    "geologyDistanceToLineamentM",
    "geologyFractureProximityScore",
    "geologyLineamentIntersectionDensity",
    "geologyFaultProximityAngleDeg",

    # Decoupled shallow groundwater model priors (CGWB / regional water table)
    "groundwaterDepthPreMonsoonM",
    "groundwaterDepthPostMonsoonM",
    "groundwaterSeasonalRiseM",

    # Climate, rainfall infiltration & multi-scale drought metrics
    "climateAnnualRainfallMm",
    "climateSeasonalRainfallMm",
    "climateRecentRainfallMm",
    "climateRainfallAnomalyPct",
    "climateSpi3",
    "climateSpi6",
    "climateSpi12",

    # Soil texture & vadose zone permeability
    "soilClayPercentage",

    # Multi-spectral satellite indices
    "satelliteNdvi",
    "satelliteNdwi",

    # Spatial evidence & nearby verified drilling network
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
