from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .schema import CATEGORICAL_FEATURES, NUMERIC_FEATURES, TASKS

try:
    from xgboost import XGBClassifier, XGBRegressor
except Exception as exc:  # pragma: no cover - environment dependent
    XGBClassifier = None
    XGBRegressor = None
    XGB_IMPORT_ERROR = str(exc)
else:
    XGB_IMPORT_ERROR = ""

try:
    from lightgbm import LGBMClassifier, LGBMRegressor
except Exception as exc:  # pragma: no cover - environment dependent
    LGBMClassifier = None
    LGBMRegressor = None
    LGBM_IMPORT_ERROR = str(exc)
else:
    LGBM_IMPORT_ERROR = ""


@dataclass(frozen=True)
class CandidateSpec:
    name: str
    algorithm: str
    available: bool
    factory: Callable[[], Any] | None
    unavailable_reason: str = ""


def build_preprocessor() -> ColumnTransformer:
    numeric = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])
    categorical = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent", missing_values=None)),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])
    return ColumnTransformer([
        ("numeric", numeric, NUMERIC_FEATURES),
        ("categorical", categorical, CATEGORICAL_FEATURES),
    ], remainder="drop", sparse_threshold=0.0)


def _trees(profile: str) -> int:
    return 40 if profile == "test" else 400


def candidate_specs(task: str, seed: int = 42, profile: str = "standard") -> list[CandidateSpec]:
    if task not in TASKS:
        raise ValueError(f"unknown task {task!r}")
    n_estimators = _trees(profile)
    specs: list[CandidateSpec] = []

    if task == "success":
        specs.extend([
            CandidateSpec(
                "logistic_regression",
                "sklearn.linear_model.LogisticRegression",
                True,
                lambda: LogisticRegression(
                    max_iter=3000,
                    class_weight="balanced",
                    solver="liblinear",
                    random_state=seed,
                ),
            ),
            CandidateSpec(
                "random_forest",
                "sklearn.ensemble.RandomForestClassifier",
                True,
                lambda: RandomForestClassifier(
                    n_estimators=n_estimators,
                    min_samples_leaf=2,
                    class_weight="balanced_subsample",
                    random_state=seed,
                    n_jobs=-1,
                ),
            ),
            CandidateSpec(
                "xgboost",
                "xgboost.XGBClassifier",
                XGBClassifier is not None,
                (lambda: XGBClassifier(
                    n_estimators=n_estimators,
                    max_depth=4,
                    learning_rate=0.05,
                    subsample=0.9,
                    colsample_bytree=0.9,
                    reg_lambda=1.0,
                    eval_metric="logloss",
                    random_state=seed,
                    n_jobs=-1,
                )) if XGBClassifier is not None else None,
                XGB_IMPORT_ERROR,
            ),
            CandidateSpec(
                "lightgbm",
                "lightgbm.LGBMClassifier",
                LGBMClassifier is not None,
                (lambda: LGBMClassifier(
                    n_estimators=n_estimators,
                    learning_rate=0.05,
                    num_leaves=31,
                    class_weight="balanced",
                    random_state=seed,
                    n_jobs=-1,
                    verbosity=-1,
                )) if LGBMClassifier is not None else None,
                LGBM_IMPORT_ERROR,
            ),
        ])
    else:
        specs.extend([
            CandidateSpec(
                "ridge_regression",
                "sklearn.linear_model.Ridge",
                True,
                lambda: Ridge(alpha=1.0),
            ),
            CandidateSpec(
                "random_forest",
                "sklearn.ensemble.RandomForestRegressor",
                True,
                lambda: RandomForestRegressor(
                    n_estimators=n_estimators,
                    min_samples_leaf=2,
                    random_state=seed,
                    n_jobs=-1,
                ),
            ),
            CandidateSpec(
                "xgboost",
                "xgboost.XGBRegressor",
                XGBRegressor is not None,
                (lambda: XGBRegressor(
                    n_estimators=n_estimators,
                    max_depth=4,
                    learning_rate=0.05,
                    subsample=0.9,
                    colsample_bytree=0.9,
                    reg_lambda=1.0,
                    objective="reg:squarederror",
                    eval_metric="rmse",
                    random_state=seed,
                    n_jobs=-1,
                )) if XGBRegressor is not None else None,
                XGB_IMPORT_ERROR,
            ),
            CandidateSpec(
                "lightgbm",
                "lightgbm.LGBMRegressor",
                LGBMRegressor is not None,
                (lambda: LGBMRegressor(
                    n_estimators=n_estimators,
                    learning_rate=0.05,
                    num_leaves=31,
                    objective="regression",
                    random_state=seed,
                    n_jobs=-1,
                    verbosity=-1,
                )) if LGBMRegressor is not None else None,
                LGBM_IMPORT_ERROR,
            ),
        ])
    return specs


def build_candidate_pipeline(spec: CandidateSpec) -> Pipeline:
    if not spec.available or spec.factory is None:
        raise RuntimeError(f"candidate {spec.name} unavailable: {spec.unavailable_reason}")
    return Pipeline([
        ("preprocess", build_preprocessor()),
        ("model", spec.factory()),
    ])
