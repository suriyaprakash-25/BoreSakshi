# BoreSakshi

Know before you drill — a verified-outcome network + AI prediction engine that tells rural households and farmers where a borewell is likely to succeed, how deep, and with what yield, before they spend lakhs.

## Structure

```text
boresakshi/
├── server/   Node + Express + MongoDB API, ingestion and geospatial feature pipeline
├── web/      React + Vite + Leaflet farmer/operator/admin UI
└── ml/       Phase 4 training + Phase 5 scientific evaluation/selection
```

## Run (two terminals)

**1) Backend** (needs MongoDB running on `mongodb://localhost:27017/`)

```bash
cd server
npm install
node seed.js     # optional: sample drill logs for a lively demo
npm start        # http://localhost:4000
```

**2) Web**

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
- [ ] Phase 6 Python ML service + Node orchestration/live inference

The live `/api/predict` path still uses the deterministic mock in `server/predict.js`. That remains deliberate: Phase 5 can scientifically select candidates, but every selection stays `servingApproved=false` until the review gate is accepted and Phase 6 exposes the selected bundle through the Python ML service.
