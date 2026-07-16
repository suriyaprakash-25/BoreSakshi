# BoreSakshi — Backend (MongoDB)

API for the borewell logging tool, the farmer prediction screen, and the public
accountability ledger. Node + Express + **MongoDB**.

- Connection: `mongodb://localhost:27017/`
- Database: `BoreSakshi`
- Collections (auto-created): `borewells`, `predictions`

## Run it

1. Make sure **MongoDB is running** locally (MongoDB Compass connected to
   `mongodb://localhost:27017/` is enough — the `BoreSakshi` DB is created
   automatically on first write).

```bash
cd server
npm install        # fetches express, cors, nanoid, mongodb, bcryptjs, jsonwebtoken, zod, express-rate-limit, dotenv
cp .env.example .env   # then edit .env — set JWT_SECRET (see the comment in the file)
node seed.js       # OPTIONAL: fills BoreSakshi with 15 sample drill logs for a demo
npm start          # starts http://localhost:4000
```

**Environment:** all secrets live in `server/.env` (gitignored). Copy `.env.example`
to `.env` and fill it in. Without a `.env` the server still runs locally against
`mongodb://localhost:27017/` using a dev JWT secret (it prints a warning). In
production (`NODE_ENV=production`) a real `JWT_SECRET` is required or the server
refuses to start.

On success you'll see:
```
MongoDB connected → BoreSakshi (collections: borewells, predictions)
BoreSakshi API running on http://localhost:4000
```

If Mongo isn't running you'll get a clear message telling you to start it.

## Test it (another terminal)

```bash
curl http://localhost:4000/api/health

curl -X POST http://localhost:4000/api/predict \
  -H "Content-Type: application/json" -d '{"lat":11.36,"lng":77.80}'

curl -X POST http://localhost:4000/api/borewells \
  -H "Content-Type: application/json" \
  -d '{"lat":11.36,"lng":77.80,"depthFt":240,"strata":"weathered rock","waterStrikeFt":210,"yieldLpm":600,"success":true,"operatorName":"Test Rig"}'

curl http://localhost:4000/api/ledger
```

Open **MongoDB Compass** → `BoreSakshi` → you'll see the documents appear live.

## API routes

| Method | Route             | Purpose                                              |
|--------|-------------------|------------------------------------------------------|
| GET    | `/api/health`     | Is the server up?                                    |
| POST   | `/api/predict`    | Farmer drops a pin → success %, depth, yield, confidence |
| POST   | `/api/borewells`  | Rig operator logs a completed job (verified outcome) |
| GET    | `/api/borewells`  | List all logged borewells (for the map)              |
| GET    | `/api/ledger`     | Public prediction-vs-actual accuracy record          |

## Notes

- **Only `db.js` talks to MongoDB.** `index.js` awaits its methods; `predict.js`
  is pure logic. To move to Atlas later, just change `MONGODB_URI`.
- **The real AI plugs into `predict.js` only** — it currently returns a realistic
  mock with the exact shape the app expects.
- Env overrides if needed: `MONGODB_URI`, `MONGODB_DB`, `PORT`.
