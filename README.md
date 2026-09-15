# BoreSakshi

Know before you drill — a verified-outcome network + AI prediction engine that tells rural households and farmers where a borewell is likely to succeed, how deep, and with what yield, before they spend lakhs.

## Structure

```text
boresakshi/
├── server/   Node + Express + MongoDB API, trusted-data orchestration and accountability ledger
├── web/      React + Vite + Leaflet farmer/operator/admin UI
└── ml/       Phase 4 training + Phase 5 evaluation + Phase 6 FastAPI inference service
```

## Runtime prediction path

```text
Farmer UI
   ↓
Node /api/predict
   ↓ verified/unflagged/eligible wells only
Python /ml/predict
   ↓
Live geospatial feature extraction
   ↓
Phase 5 selected success + depth + yield models
   ↓
Calibration + conformal uncertainty + explanations
   ↓
Node persistence/accountability ledger
```

If the Python service is unavailable, times out, rejects low feature coverage, or its circuit breaker is open, Node returns the existing deterministic heuristic **only as an explicitly labelled `heuristic_fallback`**. It is never presented as ML.

## Run locally

**1) Python ML service**

The service remains not-ready until reviewed real Phase 4/5 artifacts, the live geospatial manifest, and the explicit Phase 6 approval gate are configured.

```bash
cd ml
python -m venv .venv
# activate environment
python -m pip install -r requirements-candidates.txt
# configure the Phase 6 variables from .env.example in your shell
python -m uvicorn service:app --host 127.0.0.1 --port 8000
```

**2) Node backend** (needs MongoDB running on `mongodb://localhost:27017/`)

```bash
cd server
npm install
node seed.js     # optional demo logs
npm start        # http://localhost:4000
```

**3) Web**

```bash
cd web
npm install
npm run dev      # http://localhost:5173
```

Open `http://localhost:5173` and tap the map.

## Roadmap status

- [x] Backend API + MongoDB + accountability ledger
- [x] Farmer prediction screen (map, pin-drop, result card)
- [x] Rig-operator logging screen (voice-optional, auto-GPS) — at `/log`
- [x] Public accuracy-ledger view — at `/ledger`
- [x] Landing page (`/welcome`) + operator accounts
- [x] Operator dashboard/history + assigned sites
- [x] Admin role + console
- [x] Phase 2 real-data ingestion, provenance, review and quality gates
- [x] Phase 3 real geospatial feature-engineering pipeline
- [x] Phase 4 real-model candidate training/registry for success, water-strike depth and yield
- [x] Phase 5 spatial scientific evaluation, calibration, uncertainty, confidence intervals, coverage and candidate selection
- [x] Phase 6 Python ML service + Node orchestration/live inference with explicit approval/fallback controls

Phase 6 software is implemented, but production serving is still operationally gated: `BORESAKSHI_PHASE6_APPROVED=YES` must be set only after the real-data Phase 5 promotion checklist is reviewed. Without that approval, `/ml/health` reports not-ready and the farmer API clearly labels its heuristic fallback.
