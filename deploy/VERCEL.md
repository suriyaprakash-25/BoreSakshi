# Running on Vercel

Vercel suits demos: the map, ledger and sign-in work. It can't run the pilot, because there is no ML service, evidence uploads are refused (there is no durable disk), and rate limits are held per function instance. Use `deploy/PILOT-RUNBOOK.md` for the pilot.

Set these in the Vercel project, under Production environment variables:

| Variable | Value |
|---|---|
| `MONGODB_URI` | A hosted MongoDB connection string. Localhost can't work here. |
| `MONGODB_DB` | `BoreSakshi` |
| `JWT_SECRET` | 32+ random characters |
| `RIG_EVIDENCE_SECRET` | 32+ random characters, different from `JWT_SECRET` |
| `MONITORING_TOKEN` | 24+ random characters |
| `FRONTEND_URL` | `https://boresakshi.vercel.app`, or your own domain |
| `TRUST_PROXY` | `1` |

If any are missing, the API answers `503 API_NOT_CONFIGURED` and the function log names what's wrong.
