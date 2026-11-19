# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BoreSakshi predicts borewell success (probability, depth, yield, confidence) for a
map location, and — its core differentiator — closes an **accountability loop**:
every prediction is stored, and when a real drill outcome is later logged nearby,
the prediction is scored predicted-vs-actual to build a public accuracy ledger.

Two independent apps, each with its own `package.json` and its own README:
- `server/` — Node + Express + MongoDB API (ES modules, `"type": "module"`)
- `web/` — React 18 + Vite + Leaflet farmer prediction screen

## Commands

Run in two terminals. Backend requires **MongoDB on `mongodb://localhost:27017/`**
(DB `BoreSakshi`, collections auto-created).

```bash
# Backend (server/)
npm install
node seed.js        # optional: 15 sample drill logs around 11.36, 77.80 for demos
npm start           # http://localhost:4000  (npm run dev = node --watch)

# Web (web/)
npm install
npm run dev         # http://localhost:5173  (build / preview also available)
```

Tests: `npm run test:all` in `server/` and `npm test` in `web/`. The real-Mongo lifecycle
test runs with `PHASE17_E2E=YES`. There is no linter.

## Architecture

**There is no fallback number.** `server/predict.js` calls the Python ML service. If
the pin is outside `PILOT_BBOX` (`pilotRegion.js`), the model is unavailable, the model
refuses for low coverage, or its response breaks the contract, `predictBorewell` returns
`noEstimate()`: `estimateAvailable: false`, a `noEstimateReason`, null numbers and the
nearby summary. It is never stored in the ledger. Don't reintroduce a guessed number.
`NEAR_KM` (5) is the evidence radius for nearby wells only.

**Explainability.** `factors` comes from the model's explanations. `POST /api/predict`
also returns `nearby[]` (nearest 20) as the evidence list, with distances in half-km steps
and no place names, so a chosen pin can't triangulate a well. `PredictionPanel.jsx` shows
the estimate or the no-estimate state. "Summarise this result" restates the numbers; it
is not an AI call.

**The accountability loop** is the point of the project:
1. `POST /api/predict` (`phase11Routes.js`) stores a model estimate with `actual: null`.
   `dedupeKey` (cell, model, 30-day period) means repeat taps share one record.
2. `POST /api/borewells` (`phase8Routes.js`) stores a drill log as `SUBMITTED`. It scores
   nothing until an admin verifies it through the Phase 9 review.
3. On verification, `ledgerMatching.js` scores **one** prediction: the one linked by
   `predictionId`, within 1 km, otherwise the nearest within `MATCH_RADIUS_KM` (250 m).
   It must predate drilling by at most a year, and `claimPredictionOutcome` is atomic.
4. `GET /api/ledger` publishes accuracy for the trained model only.

**Roles & admin console.** Accounts carry a `role` ('operator' | 'admin'), `status`
('active' | 'deactivated'), and `verified` flag (older docs default via `publicOperator`).
Admins are created **manually in MongoDB** (`{$set:{role:'admin'}}`) — there is no
in-app role management; admins can only deactivate/reactivate/verify operators, never
grant admin. `requireAuth` is async and re-reads the account from the DB every request,
so a deactivation invalidates existing tokens immediately (and blocks new logs); `signin`
also blocks deactivated accounts. `requireAdmin` runs after `requireAuth`. Admin routes
(all `requireAuth,requireAdmin`): `GET /api/admin/operators`, `GET /api/admin/logs`,
`PATCH /api/admin/operators/:id` (status/verified only), `PATCH /api/admin/logs/:id`
(flag/verify). Client: `web/src/adminData.jsx` (`AdminDataProvider`/`useAdminData`) holds
all operators+logs with mutators that patch then update local state so every admin view
reflects instantly. Admin screens live in `web/src/screens/admin/` (overview, operators
table, operator detail, all-logs list with filter+sort+CSV, flagged logs, all-wells leaflet map); guarded by `RequireAdmin`;
admins get a distinct nav and are bounced off operator pages. Logs carry `flagged`/
`flagReason`/`flaggedBy` + `verified`; verified operators get a `+VERIFIED_TRUST_BONUS`
(metrics.js). Reusable `components/LogItem.jsx` + `LogFilters.jsx` + `MonthlyBars.jsx`
are shared by operator History and admin views; CSV export is `web/src/csv.js` (no dep).

**Operator auth (additive, farmer flow stays open).** Only rig operators have
accounts; the farmer map (`/`) and ledger stay public — this is deliberate (low
friction is the pitch). `server/auth.js` holds `signup`/`signin` (phone + bcrypt
password, `operators` collection) and a `requireAuth` JWT middleware; `POST
/api/borewells` is the one protected route and derives `operatorId`/`operatorName`
from the token (never from client input — don't re-add a free-text operator name).
JWT secret is `process.env.JWT_SECRET`. On the client, `web/src/auth.jsx`
keeps only a safe profile in localStorage; the HTTP-only cookie is the sole session
credential; `components/RequireOperator.jsx` gates `/log` and redirects to `/signin`
remembering `location.state.from`. `AuthScreen.jsx` serves both `/signin` and
`/signup` via a `mode` prop; `AuthBadge` (in `AppHeader`) shows name+signout or a
Sign in link. No OTP/email/OAuth — out of scope. `predict.js` and the scoring loop
were untouched.

**Security & ops (all free, no paid services).** Secrets load from `server/.env`
via `dotenv` (`import "dotenv/config"` at the top of `index.js`/`seed.js`);
`.env` is gitignored, `.env.example` is the template. `JWT_SECRET` is mandatory when
`NODE_ENV=production` (process exits if missing), dev falls back with a warning; JWT
TTL is `JWT_EXPIRES_IN` (default `7d`). Request bodies are validated by zod schemas in
`validation.js` (a `validate(schema)` middleware runs before every write handler and
replaces `req.body` with the parsed result). `middleware.js` holds: `asyncHandler`
(so async throws reach the error handler instead of hanging), `authLimiter`
(IP, 30/15min on all `/api/auth/*`), `signinBruteLimiter` (per-phone, 5 failed
sign-ins/10min, keyed by phone digits — successful logins don't count), a JSON
`notFound`, and a central `errorHandler` that maps bad JSON→400, oversized→413
(`express.json({ limit: "10kb" })`), else 500 — always clean JSON, never a hang.
`/api/health` pings Mongo (5s `serverSelectionTimeoutMS`) and returns `db: up|down`
(503 if down). Behind a proxy set `TRUST_PROXY=1` so IP limiting sees real client IPs.
When adding routes, wrap handlers in `asyncHandler` and add a zod schema — don't
hand-roll validation in the handler.

**Data access is isolated to `server/db.js`.** `index.js` only awaits `db.*`
methods; `predict.js` is pure logic with no DB access. Records use an app-generated
`nanoid(10)` `id`; Mongo's `_id` is always projected out so it never reaches the
API. To move to Atlas, change `MONGODB_URI` only. Env overrides: `MONGODB_URI`,
`MONGODB_DB`, `PORT`.

**Web → backend.** All fetch calls are centralized in `web/src/api.js`, pointing at
`VITE_API_URL` (default `http://localhost:4000`). `App.jsx` is a `react-router-dom`
router over screens in `web/src/screens/`: `FarmerScreen.jsx` at `/map` (the map — holds
prediction state; `MapView.jsx` emits tap coords via `onPick`), `LedgerScreen.jsx` at
`/ledger` (public accountability ledger), `LandingScreen.jsx` at `/`, `AuthScreen`
at `/signin` + `/signup`, and the operator-only (RequireOperator-gated) `Dashboard.jsx`
at `/dashboard` (default post-login landing), `OperatorLog.jsx` at `/log`, and
`History.jsx` at `/history`. OpenStreetMap tiles need internet; predictions don't.

**Operator dashboard/history + shared state.** `Dashboard` and `History` derive
everything from the operator's *own* logs via `GET /api/borewells/mine` plus assigned
sites via `GET /api/assignments` (both `requireAuth`). Those live in a shared context
`web/src/operatorData.jsx` (`OperatorDataProvider` / `useOperatorData`) that loads on
sign-in and exposes `{ logs, assignments, addLog, refresh }`; `OperatorLog` calls
`addLog(record)` on submit so a new log appears on Dashboard + History with no refetch.
All stat/chart math is pure functions in `web/src/metrics.js` (success rate, avg depth,
`logsPerMonth`, `strataBreakdown`, `trustScore`) — keep it there, not in components.
Charts are hand-built (no chart lib): single-hue teal bars + a sequential light→dark
teal→navy strata ramp (light = shallow/weathered, dark = hard/compact). `trustScore`
is logging volume+completeness+recency (NOT drilling success — dry holes are good data).
Assignments are not created by the app yet (nothing is seeded at signup) and auto-close
when a log lands within 2 km; logs carry an optional `placeName`, which is never public.

**Ledger screen (`/ledger`).** The moat made visible — reads `GET /api/ledger` and
shows headline accuracy, counters (issued / scored / correct / awaiting), and a table
of recent scored predictions with predicted-vs-actual and a ✓/✗ per row. Polls every
10s so it updates live during a demo. It shows misses honestly (no cherry-picking) —
that transparency is the point, so don't "fix" it to only surface correct rows.

**Shared UI system.** Every screen shares one header (`components/AppHeader.jsx` —
brand + segmented nav with `NavLink` active state; operator-only tabs Dashboard/Log/
History appear when signed in, Map/Ledger are always public; plus a right slot +
`AuthBadge`) and one design language in `styles.css`: a reusable `.card` plus CSS tokens
under `:root` (`--r-*` radii, `--ease`/`--dur` motion, `--focus` ring, `--shadow*`), a single
`.btn`/`.btn-primary`/`.btn-ghost` button system, and the navy/teal water palette. Icons
are **lucide-react** (never emoji) sized ~15–20px with `strokeWidth ~2.2`. When adding a
screen, reuse `AppHeader`, the `.btn` classes, and the tokens — don't reintroduce
per-screen button/card styles.

**Operator screen (`/log`).** Mobile-first, type-first with *optional* voice: fields
degrade gracefully if the Web Speech API is absent (`VOICE_SUPPORTED` gate). Location
auto-fills from `navigator.geolocation` but stays hand-editable. On submit it POSTs to
`/api/borewells` and the confirmation surfaces `scoredPredictions` (how many open
predictions this real outcome just closed on the ledger) — deliberately making the
operator's contribution to the accountability loop visible.

**Silent pilot.** `ML_SILENT_PILOT=YES` stores model estimates and scores them on the
ledger, but `/api/predict` answers `NOT_RELEASED` with no number. Use it for the first
season of any new model.

**Training data.** `ml/public_data/` builds helper-model data from public wells. That data
never enters `borewells`, and readings inside the pilot box are excluded by an assertion.
It also trains the groundwater model (`train_groundwater.py`, `gw_finalize.py`) on CGWB
open-well water levels across India. That model predicts shallow water-table depth, not
borewell success. `retrain_with_field_data.py` adds drilling outcomes later.
See section 9 of `docs/ml-data-and-training-plan.md`.

**Groundwater outlook (anywhere in India).** `POST /api/predict` also returns
`groundwater`, from `server/groundwater.js` → ML `POST /ml/groundwater` →
`ml/public_data/gw_live.py`. Live features are computed by the *same* code that built the
training table (`extract_features.dem_row`/`surface_row`, `india_layers.Layers`,
`gw_live.GeologyIndex`, `train_groundwater` evidence), so keep training and serving on
those functions. The outlook is context, not a prediction: it never enters the ledger and
the pilot box does not gate it (the box still gates the borewell estimate). It refuses with
`OUTSIDE_COVERAGE` (outside India or open water), `LOW_COVERAGE` (nearest monitored well
over 50 km, or a map layer missing) or `FEATURE_SOURCE_UNAVAILABLE` (cloud rasters down);
the server drops any response that fails `isValidOutlook`. It has its own client, timeout
(`ML_GROUNDWATER_TIMEOUT_MS`) and circuit breaker; `GROUNDWATER_OUTLOOK=NO` turns it off.
The ML service needs `requirements-data.txt` and the git-ignored `ml/data_public`
(model, results, `layers/`) mounted via `BORESAKSHI_PUBLIC_DATA_DIR`.
Drill logs now store `drillDetails`, `confidenceGrade` and append-only `followUps`.

**Language.** All farmer and operator text lives in `web/src/strings.js` (Tamil and
English, same keys) and is read with `useI18n()`. Tamil is the default. Admin screens are
English only.

**Offline drill logging.** `public/sw.js` caches the app shell and never `/api/`.
`offlineQueue.js` holds the record and its files in IndexedDB when there is no signal,
and `operatorData.jsx` sends them on sign-in and on the `online` event.

**Privacy.** Public wells and ledger rows round coordinates to 2 decimals (about 1 km)
and omit `placeName`. Exact data is for the owner and admins only. Signup requires
`consentAccepted` and stores `consent.version`.

## Conventions

- Coordinates are always `{ lat, lng }` numbers; both API write endpoints 400 if
  they aren't numbers.
- `NEAR_KM = 5` is the shared "nearby" radius for both confidence scoring and
  ledger matching — changing it affects both.
- Demo default center is the Namakkal / Tiruchengode belt (`11.36, 77.80`); seed
  data clusters there, so pins near it yield higher-confidence results.
