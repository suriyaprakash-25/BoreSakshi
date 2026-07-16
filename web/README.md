# BoreSakshi — Web (Farmer Prediction Screen)

React + Vite + Leaflet. The farmer-facing screen: tap a point on the map, get a
groundwater prediction (success %, depth, yield, confidence). Verified drill logs
show as coloured dots (green = water found, red = dry) so the "we learn from real
outcomes" story is visible.

## Prerequisites

The backend must be running first (see `../server`). It provides the API on
`http://localhost:4000` and MongoDB stores the data.

## Run it

```bash
cd web
npm install     # fetches react, react-dom, react-leaflet, leaflet, vite
npm run dev      # opens http://localhost:5173
```

Then open http://localhost:5173 and **tap anywhere on the map**.

> The map uses free OpenStreetMap tiles, so it needs an internet connection to
> load the map imagery (the prediction itself comes from your local backend).

## How it connects

- Calls the backend at `http://localhost:4000` (CORS is already enabled there).
- To point at a different backend, set `VITE_API_URL` before `npm run dev`,
  e.g. `VITE_API_URL=http://192.168.1.5:4000 npm run dev`.

## Files

| File | Purpose |
|------|---------|
| `src/App.jsx` | Layout, state, header with live "verified wells" + "accuracy" metrics |
| `src/components/MapView.jsx` | Leaflet map, tap-to-pick, verified-well markers |
| `src/components/PredictionPanel.jsx` | Result card (empty / loading / result states) |
| `src/components/ProbabilityRing.jsx` | Circular success gauge |
| `src/api.js` | Backend calls |
| `src/styles.css` | Theme + responsive layout (stacks on mobile) |

## Demo tip

Run `node seed.js` in the server folder first so the map has verified wells and
the accuracy metric shows a real number. Then drop a pin near the seeded cluster
(around 11.36, 77.80) to get a **High confidence** result on stage.
