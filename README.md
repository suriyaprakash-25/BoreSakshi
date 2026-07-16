# BoreSakshi

Know before you drill — a verified-outcome network + AI prediction engine that
tells rural households and farmers where a borewell is likely to succeed, how
deep, and with what yield, before they spend lakhs.

## Structure

```
boresakshi/
├── server/   Node + Express + MongoDB API (prediction, logging, accountability ledger)
└── web/      React + Vite + Leaflet farmer prediction screen
```

## Run (two terminals)

**1) Backend** (needs MongoDB running on mongodb://localhost:27017/)
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

Open http://localhost:5173 and tap the map.

## Roadmap status

- [x] Backend API + MongoDB + accountability ledger
- [x] Farmer prediction screen (map, pin-drop, result card)
- [x] Rig-operator logging screen (voice-optional, auto-GPS) — at `/log`
- [x] Public accuracy-ledger view — at `/ledger`
- [x] Landing page (`/welcome`) + operator accounts (JWT sign up/sign in; farmer flow stays open)
- [x] Operator dashboard (`/dashboard`) + history (`/history`) — trust score, stats, charts, assigned sites
- [x] Admin role + console (`/admin/*`) — overview, operators table/detail, flagging, verification, all-wells map, CSV export
- [ ] Real AI model (drops into server/predict.js only)

The prediction is currently a realistic **mock** in `server/predict.js` — the app
is fully wired so the real model plugs into that one file later, unchanged
everywhere else.
