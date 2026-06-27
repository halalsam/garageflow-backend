# GarageFlow Backend

NestJS + Prisma + PostgreSQL API that serves the exact contract the GarageFlow
mobile app (`../garageflow`) already consumes. India-first: ₹ (paise in DB), GST,
Indian plates, roles `tech`/`manager`/`admin`.

- **What to build / scope** → [`REQUIREMENTS.md`](./REQUIREMENTS.md)
- **How it's put together / patterns** → [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Wiring the Expo app to this API** → [`../garageflow/INTEGRATION.md`](../garageflow/INTEGRATION.md)

## Stack

NestJS 11 · Prisma 7 (pg driver adapter) · PostgreSQL 16 · JWT (access + rotating
refresh) · bcrypt · class-validator. TypeScript throughout. Latest majors.

> **Prisma 7 note:** the DB URL is **not** in `schema.prisma`. The CLI reads it
> from [`prisma.config.ts`](./prisma.config.ts); the runtime client connects via
> the `@prisma/adapter-pg` adapter in `src/prisma/prisma.service.ts`.

## Quick start

```bash
cp .env.example .env            # adjust if needed (DB port is 5434)
docker compose up -d            # Postgres 16 on localhost:5434
npm install
npm run prisma:migrate          # create + apply migrations, generate client
npm run prisma:seed             # load the demo data (mirrors the app's mock)
npm run start:dev               # http://localhost:3000/api
```

Health check: `curl http://localhost:3000/api/health`

## API documentation (Swagger / OpenAPI)

Interactive docs are served at **`http://localhost:3000/api/docs`** (Swagger UI).
Click **Authorize**, paste an access token from `/auth/login`, and try any
endpoint. Request/response schemas are generated from the DTOs and JSDoc via the
`@nestjs/swagger` CLI plugin (`nest-cli.json`).

- Raw spec (live): `GET /api/docs-json`
- A copy is written to **`openapi.json`** on every server boot — feed it to a
  client generator (e.g. `openapi-typescript`) for the mobile app's typed client.

### Dev logins (all password `password123`)

| Email | Role | Lands on |
| --- | --- | --- |
| `admin@garageflow.test` | admin | dashboard |
| `manager@garageflow.test` | manager | dashboard |
| `arjun@garageflow.test` | tech | jobs |
| `suresh@garageflow.test` | tech | jobs |
| `ramesh@garageflow.test` | tech (inactive — cannot log in) | — |

New staff invited via `POST /team` get the default password `garageflow123`
unless one is supplied.

## Scripts

| Script | Does |
| --- | --- |
| `npm run start:dev` | watch-mode dev server |
| `npm run build` / `npm start` | compile to `dist/main.js` / run |
| `npm run prisma:migrate` | new migration + apply + regenerate client |
| `npm run prisma:generate` | regenerate client only |
| `npm run prisma:seed` | re-seed (clears in FK order first) |
| `npm run db:reset` | drop, re-migrate, re-seed |

## Auth (token-based, role-routed)

`POST /auth/login { email, password }` → `{ user, tokens }`. The `user` payload
carries `role` + `roleLabel` + `roleIcon`, so the app routes straight to the
right home (no role picker). Short-lived access JWT + rotating refresh JWT
(hash stored on the user). See [`../garageflow/INTEGRATION.md`](../garageflow/INTEGRATION.md)
for the client wiring.

```bash
# login → grab the access token
TOK=$(curl -s -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"manager@garageflow.test","password":"password123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["tokens"]["accessToken"])')

curl localhost:3000/api/jobs -H "Authorization: Bearer $TOK"
```

## Smoke tests (prove the contract + seed assertions)

With the server running and a manager token in `$TOK`:

```bash
# Derived finance figures must reproduce the app exactly (REQUIREMENTS §10):
curl -s "localhost:3000/api/finance/summary?day=2026-06-27" -H "Authorization: Bearer $TOK"
#   → outstanding 22846, collectedToday 16033, revenueThisWeek 32948
curl -s "localhost:3000/api/finance/gst?month=2026-06"     -H "Authorization: Bearer $TOK"  # gst 5931
curl -s "localhost:3000/api/finance/profit?month=2026-06"  -H "Authorization: Bearer $TOK"  # profit 7848
curl -s "localhost:3000/api/finance/ledgers"               -H "Authorization: Bearer $TOK"  # Rakesh K. closing 15400

# RBAC: a TECH token is 403 on finance/approvals/team/invoices/expenses.
```

These are wired into the verification in REQUIREMENTS §10 / §13 and all pass on a
fresh seed.

## Layout

```
src/
  common/        serializers · enum-maps · format · guards · decorators · filters · storage
  prisma/        global PrismaService (pg adapter)
  auth/          login / refresh / logout / me  (JWT)
  users/         /team        (ADMIN)
  customers/  vehicles/  catalogue/
  jobs/          jobs + timeline (multipart) + parts + POST /jobs/:id/estimate
  estimates/     /approvals  (manager+) + decision → invoice
  invoices/      invoices + payments  (manager+)
  expenses/      (manager+)
  finance/       derived reports: summary, receivables, collections, gst, profit, ledgers  (manager+)
  dashboard/     role-aware metrics + active jobs + activity
  health/        public health check
prisma/          schema.prisma · seed.ts · migrations/
```

Every response leaves through `src/common/serializers.ts` — never a raw Prisma
row. See ARCHITECTURE.md for the request lifecycle and the "add a module" recipe.

## Notes / gotchas

- **`dist/main.js`** (not `dist/src/main.js`) — `tsconfig.build.json` pins
  `rootDir: src`. `incremental` is off so a failed build can't leave a poisoned
  `.tsbuildinfo` that emits declaration-only output.
- **DB port 5434** — 5432/5433 are commonly taken locally; keep
  `docker-compose.yml` and `DATABASE_URL` in sync.
- **Uploads** are served at `/uploads` (un-prefixed); timeline photo/voice files
  go through the S3-swappable `StorageService`.
