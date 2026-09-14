# BoreSakshi

Know before you drill — a verified-outcome network + AI prediction engine that tells rural households and farmers where a borewell is likely to succeed, how deep, and with what yield, before they spend lakhs.

## Structure

```text
boresakshi/
├── server/   Node + Express + MongoDB API, trusted rig-data collection and accountability ledger
├── web/      React + Vite + Leaflet farmer/operator/admin UI
└── ml/       training + scientific evaluation + FastAPI serving + activation preflight
```

## Runtime prediction path

```text
Farmer UI
   ↓
Node /api/predict
   ↓ verified/unflagged/eligible wells only
Python /ml/predict
   ↓
Live checksum-verified geospatial feature extraction
   ↓
Phase 5-selected success + depth + yield models
   ↓
Calibration + conformal uncertainty + explanations
   ↓
Phase 7 versioned prediction-contract validation
   ↓
Node contract validation + persistence/accountability ledger
```

Every accepted ML prediction carries a model version, feature version, prediction timestamp, uncertainty, explanations, coverage metadata and an immutable `featureSnapshotRef`. If the Python service is unavailable or returns an invalid/insufficient-coverage response, Node returns the deterministic heuristic **only as an explicitly labelled `heuristic_fallback`**. It is never presented as ML.

## Rig-operator outcome path

```text
Authenticated operator
   ↓
Device GPS + accuracy + drilling date
   ↓
Depth / strike / yield + geological layers
   ↓
Photo evidence (+ optional video)
   ↓
SUBMITTED / unverified / dataset-ineligible
   ↓
Admin review gate
   ↓
Verified + unflagged + eligible
   ↓
Public data / ML evidence / future training / accountability ledger
```

Phase 8 intentionally prevents a raw operator submission from becoming trusted groundwater evidence before verification.

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

**2) Node backend**

```bash
cd server
npm install
# copy server/.env.example to .env and configure JWT/RIG evidence secrets
node seed.js     # optional demo logs
npm start        # http://localhost:4000
```

Phase 8 evidence is stored under `RIG_MEDIA_DIR`. Production deployment must use durable/private storage; the local default is for development and application-contract validation.

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
- [ ] Phase 9 — verification and data trust
- [ ] Phase 10 — continuous learning with human-reviewed promotion
- [ ] Phase 11 — strengthened prediction accountability ledger
- [ ] Phase 15 — production security and reliability
- [ ] Phase 17 — full testing
- [ ] Phase 18 — deployment and DevOps

Phase 8 software is complete when its CI/review gate passes. Phase 9 remains responsible for the full verification state machine and production trust model; Phase 15 must remediate dependency/security findings before launch; Phase 18 must provide durable evidence storage and production deployment infrastructure.
