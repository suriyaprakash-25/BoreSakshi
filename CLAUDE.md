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

There is **no test suite and no linter.** Verify the backend with curl (examples
in `server/README.md`) against `/api/health`, `/api/predict`, `/api/borewells`,
`/api/ledger`.

## Architecture

**The prediction is a deterministic mock.** `server/predict.js` is the single file
the real AI model plugs into. `predictBorewell({lat,lng,nearbyLogs})` returns a fixed
output shape (`successProbability`, `depthBandFt`, `expectedYieldLpm`, `confidence`,
`rockType`, `basis`, `isMock`, plus explainability: `factors[]` and `confidenceReason`);
it must keep that shape so nothing downstream changes. Results are seeded from lat/lng so
the same pin always gives the same answer (demos must be repeatable — never introduce
randomness here). `NEAR_KM` (5) is exported from here and imported by `index.js` — one
source of truth for the nearby radius.

**Explainability (all heuristic today, real-model SHAP later — same shape).** `factors`
is a `{label, impact}[]` decomposition whose impacts are probability POINTS and literally
sum to `successProbability` before the 8–95 clamp: `50 baseline + geology + nearby
successes − nearby failures`. Nearby verified logs (real drill outcomes within `NEAR_KM`,
passed in as `nearbyLogs`) are distance-weighted (linear, 1 at the pin → 0 at the edge);
with zero neighbours the nearby terms are 0 and the score reduces exactly to the old
geology-only value, so isolated pins never shift. `confidenceReason` carries the
nearby count/success/fail split, radius, and freshest nearby log date. `POST /api/predict`
also returns a trimmed `nearby[]` (nearest 20, with `distanceKm`) as the evidence list —
no separate endpoint. Frontend surfaces all of this in `PredictionPanel.jsx`: "Why this
prediction?" (factor bars), "Why this confidence?", a Nearby-wells explorer, and **Ask
BoreSakshi** — a pure string-templating restatement of the same numbers (NOT an AI/LLM
call, no network). When the real model lands, emit its feature importances into `factors`
and none of this UI changes.

**The accountability loop** lives in `server/index.js` and is the point of the
project:
1. `POST /api/predict` computes a prediction and stores it with `actual: null`.
2. `POST /api/borewells` logs a verified drill outcome, then scans all open
   predictions (`actual == null`) within `NEAR_KM` (5 km, Haversine via
   `distanceKm`) and closes each by setting `actual` + `correct`
   (predicted success = `successProbability >= 50`).
3. `GET /api/ledger` aggregates closed predictions into a public accuracy figure.

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
restores the safe profile from `GET /api/auth/session`; the HTTP-only cookie is the
sole session credential and no authentication state is kept in localStorage; `components/RequireOperator.jsx` gates `/log` and redirects to `/signin`
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
router over screens in `web/src/screens/`: `FarmerScreen.jsx` at `/` (the map — holds
prediction state; `MapView.jsx` emits tap coords via `onPick`), `LedgerScreen.jsx` at
`/ledger` (public accountability ledger), `LandingScreen.jsx` at `/welcome`, `AuthScreen`
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
Assignments are seeded per operator at signup (`db.seedAssignmentsForOperator`) and
auto-close when a log lands within 2 km; logs carry an optional `placeName`.

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

## Conventions

- Coordinates are always `{ lat, lng }` numbers; both API write endpoints 400 if
  they aren't numbers.
- `NEAR_KM = 5` is the shared "nearby" radius for both confidence scoring and
  ledger matching — changing it affects both.
- Demo default center is the Namakkal / Tiruchengode belt (`11.36, 77.80`); seed
  data clusters there, so pins near it yield higher-confidence results.
