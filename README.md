# BoreSakshi

Know before you drill — a verified-outcome network + AI prediction engine that tells rural households and farmers where a borewell is likely to succeed, how deep, and with what yield, before they spend lakhs.

## Structure

```text
boresakshi/
├── server/   Node + Express + MongoDB API, trusted rig-data collection and accountability ledger
├── web/      React + Vite + Leaflet farmer/operator/admin UI
└── ml/       training + scientific evaluation + FastAPI serving + adaptive retraining/deployment controls
```

## Runtime prediction path

```text
Farmer UI
   ↓
Node /api/predict
   ↓ Phase 9 VERIFIED / unflagged / eligible wells only
Python /ml/predict
   ↓
Live checksum-verified geospatial feature extraction
   ↓
Human-approved active model deployment pointer
   ↓
Phase 5-selected success + depth + yield models
   ↓
Calibration + conformal uncertainty + explanations
   ↓
Phase 7 versioned prediction-contract validation
   ↓
Node contract validation + Phase 11 accountability snapshot
```

Every accepted ML prediction carries a model version, feature version, prediction timestamp, uncertainty, explanations, coverage metadata and an immutable `featureSnapshotRef`. If the Python service is unavailable or returns an invalid/insufficient-coverage response, Node returns the deterministic heuristic **only as an explicitly labelled `heuristic_fallback`**. It is never presented as ML.

## Rig-operator verification path

```text
Authenticated operator
   ↓
Device GPS + accuracy + drilling date
   ↓
Depth / strike / yield + geological layers
   ↓
Photo evidence (+ optional video)
   ↓
SUBMITTED / untrusted
   ↓
UNDER_REVIEW
   ↓
Deterministic review signals + human evidence review
   ↓
VERIFIED  or  REJECTED
   ↓
Only VERIFIED + unflagged + eligible outcomes become
public data / ML evidence / future training / ledger truth
```

Phase 8 provides structured evidence-backed field collection. Phase 9 provides the formal human verification lifecycle, deterministic suspicious-data review, append-only review audit and server-computed operator trust profile.

The Phase 9 trust/risk scores are operational review aids, not groundwater-model probabilities and not substitutes for Phase 5 scientific ML validation.

## Continuous learning path

```text
Phase 9 VERIFIED outcomes
   ↓
new versioned feature dataset
   ↓
checksummed TrainingDatasetVersion
   ↓
Phase 4 candidate training
   ↓
Phase 5 spatial scientific evaluation
   ↓
production-model comparison
   ↓
HUMAN APPROVAL
   ↓
STAGED deployment
   ↓ explicit DEPLOY
ACTIVE deployment pointer
   ↓
Phase 11 post-deployment accountability metrics
   ↓ human monitoring/review
   ↓ explicit ROLLBACK when required
```

Phase 10 is continuous learning/adaptive retraining, **not reinforcement learning**. A new upload can never directly overwrite the production model. Automated comparison guards can hold a candidate for review, but only a separate human approval artifact and explicit deployment action can activate it.

## Prediction accountability path

```text
Persisted prediction
   ↓
model/deployment/probability/depth/yield snapshot
   ↓
real borewell drilled
   ↓
Phase 9 VERIFIED outcome
   ↓
pre-drilling prediction matched within accountability radius
   ↓
correctness + Brier/calibration + strike/yield errors
   ↓
regional + model-version + source performance
   ↓
Phase 10 monitoring input
```

Phase 11 preserves real ML model versions separately from `heuristic_fallback`. If outcome trust is later reopened or removed, that outcome is removed from current performance metrics and the reopening is retained in append-only accountability history.

## Run locally

**1) Python ML service**

The service remains not-ready until reviewed real Phase 4/5 artifacts, the live geospatial manifest, and the explicit serving approval gate are configured.

```bash
cd ml
python -m venv .venv
# activate environment
python -m pip install -r requirements-candidates.txt
# configure values from ml/.env.example in your shell
python -m uvicorn service:app --host 127.0.0.1 --port 8000
```

For a reviewed real-artifact v1 activation candidate, run the Phase 7 preflight before routing farmer traffic:

```bash
python activate.py --lat 11.36 --lng 77.80 --activation-id boresakshi-v1-candidate --out activations/boresakshi-v1-candidate
```

Phase 10 adaptive retraining is managed through `ml/continuous.py`:

```bash
python continuous.py stage ...
python continuous.py approve ...
python continuous.py stage-deployment ...
python continuous.py activate ... --confirm DEPLOY
python continuous.py monitor ...
python continuous.py rollback ... --confirm ROLLBACK
```

When `BORESAKSHI_DEPLOYMENT_MANIFEST` points to a checksummed ACTIVE Phase 10 deployment pointer, the ML service resolves that exact reviewed model/evaluation/feature chain. `BORESAKSHI_PHASE6_APPROVED=YES` remains a mandatory global serving kill switch.

**2) Node backend**

```bash
cd server
npm install
# copy server/.env.example to .env and configure JWT/RIG evidence secrets
node seed.js     # optional demo logs
npm start        # http://localhost:4000
```

Phase 8 evidence is stored under `RIG_MEDIA_DIR`. Production deployment must use durable/private storage; the local default is for development and application-contract validation.

Verification review is available to admins at `/admin/review`. Rig operators see their server-computed Phase 9 trust profile on the dashboard and can request re-review for rejected submissions from History.

The public `/ledger` page now reports persisted prediction counts, classification accuracy, Brier/calibration, water-strike/yield error, model-version performance and regional performance. `GET /api/ledger`, `/api/ledger/entries`, `/api/ledger/models` and `/api/ledger/regions` expose the same additive accountability contract.

**3) Web**

```bash
cd web
npm install
npm run dev      # http://localhost:5173
```

## Roadmap status

- [x] Phase 2 — real-data ingestion, provenance, review and quality gates
- [x] Phase 3 — real geospatial feature-engineering pipeline
- [x] Phase 4 — real-model candidate training/registry
- [x] Phase 5 — spatial scientific evaluation/calibration/uncertainty/selection
- [x] Phase 6 — Python ML service + Node orchestration with explicit fallback controls
- [x] Phase 7 — real prediction-engine contract, immutable feature snapshots and activation preflight
- [x] Phase 8 — authenticated structured rig-operator data collection + evidence + untrusted-by-default gate
- [x] Phase 9 — formal verification lifecycle + suspicious-data review + operator/data trust + append-only audit
- [x] Phase 10 — adaptive retraining + production comparison + human approval + staged activation + rollback controls
- [x] Phase 11 — model-version prediction accountability, calibration, depth/yield error and regional performance
- [ ] Phase 15 — production security and reliability
- [ ] Phase 17 — full testing
- [ ] Phase 18 — deployment and DevOps

Phase 10 consumes only Phase 9-trusted data and never automatically replaces production. Phase 11 supplies model-version-scoped post-deployment evidence to Phase 10 monitoring but never auto-retrains or auto-rolls back a model. Phase 15 must remediate dependency/security findings before launch; Phase 18 must provide durable evidence storage, backups and production deployment infrastructure.
