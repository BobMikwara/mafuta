# FuelTrack EA - Vercel + Supabase Production Guide

This guide takes you from zero to production with React frontend on Vercel and Postgres on Supabase.

## Architecture

```
Vercel (Frontend)  -> apps/web/dist (Vite React)
Vercel (Backend)   -> api/index.ts (Fastify serverless)
Supabase (DB)      -> Postgres + Prisma (pooled 6543 for app, 5432 for migrations)
```

- Frontend talks to backend via relative `/v1/*` or `VITE_API_URL`
- Backend uses Prisma repositories when `DATABASE_URL` contains `supabase` or `USE_PRISMA=true`, otherwise in-memory (dev)
- API keys are hashed (SHA-256) and stored in `api_keys` table

## Step 1: Supabase Project

1. Create project at https://supabase.com (region EU or closest to TZ)
2. Project Settings > Database > Connection String
   - Pooled (6543) for app: `DATABASE_URL`
   - Direct (5432) for migrations: `DIRECT_URL`
3. Example:
   ```
   DATABASE_URL=postgresql://postgres.<ref>:<pwd>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true
   DIRECT_URL=postgresql://postgres.<ref>:<pwd>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```

## Step 2: Database Schema & Migrations

```bash
# Local .env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fueltrack_dev
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/fueltrack_dev

npm install
npm run db:generate
npm run db:deploy   # applies prisma/migrations/*

# For Supabase production, Prisma uses DIRECT_URL (schema.prisma `directUrl`)
# for migrations automatically, so no DATABASE_URL override is needed:
npm run db:deploy
```

Migrations:
- `0001_init` baseline (13 tables)
- `0002_idempotency_key` tenant-scoped idempotency
- `0003_add_api_keys` new table for hashed API keys

Check drift:
```bash
export SHADOW_DATABASE_URL=postgresql://fueltrack:fueltrack@localhost:5433/fueltrack_shadow
npm run db:drift
```

## Step 2b: Migrations On Cold Start (serverless)

Vercel runs `prisma generate` at build time but never `prisma migrate deploy`,
so a fresh Supabase database has no tables and every `/v1/*` request fails with
Prisma `P2021` ("table does not exist"), which surfaces to clients as a `401`
(the API key lookup is the first query of every request).

Set `FUELTRACK_AUTO_MIGRATE=true` and the function applies the committed
migrations itself on cold start, before seeding:

- It reads `prisma/migrations/<name>/migration.sql` from the deployed bundle
  (`vercel.json` `includeFiles` ships them) and applies them in version order.
- It writes the same `_prisma_migrations` bookkeeping table the Prisma CLI uses,
  so a later `prisma migrate deploy` sees them as applied and does not re-run.
- It is idempotent: a warm instance or a second deploy applies nothing.
- It runs under a Postgres advisory lock, so concurrent cold starts apply the
  migrations exactly once instead of racing.
- It connects with `DIRECT_URL` when set. Supabase puts the app behind a
  transaction-mode pooler (`DATABASE_URL`, port 6543) that cannot run DDL or hold
  session locks, so migrations must use the direct connection (port 5432).
- It never crashes the boot: a failure is logged as `db.migrate_failed` with the
  step and SQLSTATE, and `/healthz` reports `"database":"unmigrated"`.

Environment:

```
FUELTRACK_AUTO_MIGRATE=true
# Optional: where prisma/migrations lives inside the bundle, if auto-detection
# does not find it.
FUELTRACK_MIGRATIONS_DIR=
```

The same flag works for the long-running server (`apps/api-server`) via
`npm start`. To apply migrations manually instead (no runtime flag), run
`npm run db:deploy` with `DIRECT_URL` set, as in Step 2.

## Step 3: Prisma Repositories (implemented)

Located in `packages/core/src/adapters/prisma/`:

- `client.ts` singleton PrismaClient with globalThis cache for Vercel warm starts + `ensureTenantExists()`
- `mappers.ts` converts between domain (Site/Tank/Reading/Alarm) and Prisma (Station/Tank/TankReading/Alert)
- `prisma-repositories.ts` implements `Repositories` port with tenant isolation
- `prisma-api-key-registry.ts` implements `ApiKeyRegistry` with hashed lookup

Enable via env:
```
USE_PRISMA=true
# or
DATABASE_URL contains "supabase" -> auto-enabled
```

In `packages/api/src/dependency-factory.ts`:
```ts
const usePrisma = shouldUsePrisma(options.usePrisma) // checks USE_PRISMA or supabase URL
repositories = usePrisma ? createPrismaRepositories() : createMemoryRepositories()
apiKeys = usePrisma ? createPrismaApiKeyRegistry() : createMemoryApiKeyRegistry()
```

## Step 4: Backend on Vercel

`vercel.json`:
```json
{
  "buildCommand": "npm run db:generate && npm run build",
  "outputDirectory": "apps/web/dist",
  "framework": "vite",
  "functions": { "api/index.ts": { "includeFiles": "{apps/api-server/public/**,prisma/migrations/**}" } },
  "rewrites": [
    { "source": "/healthz", "destination": "/api" },
    { "source": "/v1/(.*)", "destination": "/api" }
  ]
}
```

`api/index.ts` is a Vercel serverless function:
- Reads config from env (same as api-server)
- Creates platform deps (Prisma if env set)
- Applies committed migrations on cold start if `FUELTRACK_AUTO_MIGRATE=true` (see Step 2b)
- Seeds demo if `FUELTRACK_SEED_DEMO=true`
- Finds dashboard dir via multiple candidates
- Caches app on `globalThis` for warm invocations
- `app.server.emit('request', req, res)` to handle Fastify

## Step 5: Frontend React (apps/web)

Scaffolded with Vite + React + TypeScript:

```
apps/web/
  package.json
  vite.config.ts (proxy /v1 to localhost:3000)
  index.html
  src/
    main.tsx
    App.tsx (polls /v1/tanks, /v1/alarms every 5s)
    lib/api.ts (fetch wrappers)
    components/ConnectionPanel, TanksTable, AlarmsList
    styles.css (no purple hues)
```

Env:
```
VITE_API_URL=https://your-api.vercel.app (empty = relative, works on Vercel)
```

Build:
```bash
npm run build -w @fueltrack/web # -> apps/web/dist
npm run dev -w @fueltrack/web    # -> http://localhost:5173 with proxy to :3000
```

## Step 6: Vercel Deployment

1. Import GitHub repo in Vercel
2. Settings:
   - Framework: Vite (detected)
   - Build Command: `npm run db:generate && npm run build` (from vercel.json)
   - Output Directory: `apps/web/dist`
   - Install Command: `npm ci`
3. Env Vars (Production). Set them for every environment that serves the API, otherwise a Preview deployment has no credential store and rejects the Production key. See [api-key-provisioning.md](api-key-provisioning.md) for the full reference.
   ```
   DATABASE_URL=postgresql://...:6543/postgres?pgbouncer=true
   DIRECT_URL=postgresql://...:5432/postgres
   USE_PRISMA=true
   FUELTRACK_AUTO_MIGRATE=true
   FUELTRACK_REQUIRE_CREDENTIALS=true
   FUELTRACK_SEED_DEMO=true
   FUELTRACK_DEV_API_KEY=<16+ chars random>
   FUELTRACK_DEMO_TENANT_ID=demo-tenant
   FUELTRACK_LOG_LEVEL=info
   ```
   `FUELTRACK_DEV_API_KEY` is only installed by the seed, so it does nothing on its own: `FUELTRACK_SEED_DEMO` must be `true`, or the key must be provisioned with `npm run key:provision`. For a real tenant prefer provisioning and leave the seed off.
4. Deploy
5. Run migration: `prisma migrate deploy` uses `DIRECT_URL` via `directUrl` in `schema.prisma`
6. Test: `https://your-app.vercel.app/healthz` -> `{"status":"ok","persistence":"prisma","database":"up"}`.
   - 503 with `"database":"down"`: the API is running but cannot reach Supabase. Follow the `internal_error` entry in Troubleshooting below.
   - 503 with `"database":"unmigrated"`: the connection works but the tables are missing, so migrations never ran. Set `FUELTRACK_AUTO_MIGRATE=true` and redeploy, or run `npm run db:deploy` once. See Step 2b.

## Step 7: Local Dev with Supabase

```bash
# Terminal 1: API with Supabase
DATABASE_URL=postgresql://...:6543/postgres DIRECT_URL=postgresql://...:5432/postgres \
USE_PRISMA=true FUELTRACK_SEED_DEMO=true FUELTRACK_DEV_API_KEY=local-dev-key-123456 \
PORT=3000 npm run build -w @fueltrack/api-server && node apps/api-server/dist/index.js

# Terminal 2: React
VITE_API_URL=http://localhost:3000 npm run dev -w @fueltrack/web
# Open http://localhost:5173

# Terminal 3: Simulator
node apps/simulator-runner/dist/index.js --api-url http://localhost:3000 --api-key local-dev-key-123456 --tank-id <from GET /v1/tanks> --scenario nominal
```

## Step 8: Production Hardening

- Rate limiting: Fastify plugin on `/v1/ingest`
- CORS: allow only `https://your-frontend.vercel.app`
- Supabase: enable daily backups, PITR, restrict direct DB access
- Monitoring: Vercel Analytics + Sentry
- Secrets: Vercel Env, never in repo
- Audit logs: implement `AuditLog` writes on privileged actions
- RLS: keep disabled if using Prisma, enable if using Supabase Auth directly

## Troubleshooting

- `API key rejected. Check the key and try again. Valid API key credentials are required.` in the console while `/healthz`, `/` and the login screen work -> the presented key is not in the credential store the request was checked against. The store is either unprovisioned or not the one that was seeded. Diagnose in this order:
  1. `GET /healthz`. `"credentials":"empty"` (HTTP 503, `status:"degraded"`) means no usable key exists in the deployment at all, so no key can be accepted: provision one with `npm run key:provision` or enable `FUELTRACK_SEED_DEMO=true` with `FUELTRACK_DEV_API_KEY`. `"credentials":"ready"` means other keys exist, so the pasted one is unknown, revoked or expired. `"credentials":"unavailable"` means the store could not be read: check `database` and `DATABASE_URL`.
  2. Vercel > Project > Logs (Functions): `auth.rejected` carries the non-secret reason and how many usable credentials the store holds (`usableCredentials`). `0` is a provisioning fault, any other number is a wrong key.
  3. `credentials.missing` names the misconfiguration in its `hint`. The two common ones: `FUELTRACK_DEV_API_KEY` is set but `FUELTRACK_SEED_DEMO` is not `true` (the key is only installed by the seed), and the key was provisioned for a different environment (Production versus Preview) or a different Vercel project that the console is actually talking to, which the console now shows as the `API: <origin>` part of the message.
  4. `credentials.ephemeral_store` warns that the deployment is using in-memory persistence. Keys there are per instance and lost on cold start, so a key can be accepted by one request and rejected by the next: set `USE_PRISMA=true` and `DATABASE_URL`.
  5. `seed.step_failed` with `step:"api-key"` means the seed could not store the credential (usually the `api_keys` table is missing because migrations were not applied). Run `npm run db:deploy`, then redeploy.
- `No Output Directory named "build"` -> fixed by `vercel.json` outputDirectory `apps/web/dist`
- `prisma generate` fails in Vercel -> ensure `buildCommand` includes it, and `@prisma/client` in dependencies
- `Missing script: "db:generate"` with npm error location `packages/api` -> the Vercel Root Directory is set to `packages/api`. Clear it in Project Settings > General > Root Directory so the build runs from the repo root, where `db:generate` and the workspace build live. Root Directory cannot be set in `vercel.json`, it is a dashboard-only setting.
- `Can't reach database` on Vercel -> use pooled 6543 URL with `?pgbouncer=true`, not direct 5432 for app
- `{"error":"internal_error","requestId":"req-..."}` on every `/v1/*` call while `/healthz`, `/` and unauthenticated 401s work -> the database layer throws on its first query (the API key lookup inside auth), so every request with a Bearer header fails the same way. Diagnose in this order:
  1. `GET /healthz`. `"database":"down"` (HTTP 503, `status:"degraded"`) confirms the app cannot query the database; `"persistence"` shows which backend is active (`prisma` or `memory`).
  2. Vercel > Project > Logs (Functions): find `http.unhandled_error` with the same `requestId`. `reason` and `code` name the cause:
     - `PrismaClientInitializationError` / `P1001` unreachable: `DATABASE_URL` points at the direct host (`db.<ref>.supabase.co`), which is IPv6-only on free plans and unreachable from Vercel functions. Use the pooler host (`aws-0-<region>.pooler.supabase.com:6543` with `?pgbouncer=true`).
     - `P1000` authentication failed: the database password in `DATABASE_URL` is wrong or contains unescaped reserved characters. URL-encode it (`@` -> `%40`, `#` -> `%23`, `/` -> `%2F`).
     - `PrismaClientKnownRequestError` / `P2021` table does not exist: migrations were never applied to Supabase. Set `FUELTRACK_AUTO_MIGRATE=true` and redeploy so the function applies them on cold start (Step 2b), or run `npm run db:deploy` once with `DIRECT_URL` set. `/healthz` reports `"database":"unmigrated"` while the tables are missing. This also applies when only older migrations ran and `api_keys` (0003) is missing.
     - "Environment variable not found: DATABASE_URL": `USE_PRISMA=true` is set but `DATABASE_URL` is missing in Vercel env, add it and redeploy.
  3. Cold-start seed failures appear as `seed.step_failed` warnings with the failing step (`site`, `tank-diesel-1`, `tank-petrol95-2`, `api-key`), so a seed that silently skipped the demo key can no longer be mistaken for an auth problem.
- In-memory data lost on Vercel -> set `USE_PRISMA=true` and `DATABASE_URL`
- CORS errors -> set `VITE_API_URL` to backend URL or use relative URLs when frontend and backend same Vercel project

## One-Click Deploy

With this branch:
1. Push to GitHub
2. Vercel auto-deploys frontend + backend
3. Supabase holds data
4. Visit `https://your-app.vercel.app`, paste API key from env, see tanks and alarms
