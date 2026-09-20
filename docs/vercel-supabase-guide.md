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
  "functions": { "api/index.ts": { "includeFiles": "apps/api-server/public/**" } },
  "rewrites": [
    { "source": "/healthz", "destination": "/api" },
    { "source": "/v1/(.*)", "destination": "/api" }
  ]
}
```

`api/index.ts` is a Vercel serverless function:
- Reads config from env (same as api-server)
- Creates platform deps (Prisma if env set)
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
3. Env Vars (Production):
   ```
   DATABASE_URL=postgresql://...:6543/postgres?pgbouncer=true
   DIRECT_URL=postgresql://...:5432/postgres
   USE_PRISMA=true
   FUELTRACK_SEED_DEMO=true
   FUELTRACK_DEV_API_KEY=<16+ chars random>
   FUELTRACK_DEMO_TENANT_ID=demo-tenant
   FUELTRACK_LOG_LEVEL=info
   ```
4. Deploy
5. Run migration: `prisma migrate deploy` uses `DIRECT_URL` via `directUrl` in `schema.prisma`
6. Test: `https://your-app.vercel.app/healthz` -> `{"status":"ok"}`

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

- `No Output Directory named "build"` -> fixed by `vercel.json` outputDirectory `apps/web/dist`
- `prisma generate` fails in Vercel -> ensure `buildCommand` includes it, and `@prisma/client` in dependencies
- `Missing script: "db:generate"` with npm error location `packages/api` -> the Vercel Root Directory is set to `packages/api`. Clear it in Project Settings > General > Root Directory so the build runs from the repo root, where `db:generate` and the workspace build live. Root Directory cannot be set in `vercel.json`, it is a dashboard-only setting.
- `Can't reach database` on Vercel -> use pooled 6543 URL with `?pgbouncer=true`, not direct 5432 for app
- In-memory data lost on Vercel -> set `USE_PRISMA=true` and `DATABASE_URL`
- CORS errors -> set `VITE_API_URL` to backend URL or use relative URLs when frontend and backend same Vercel project

## One-Click Deploy

With this branch:
1. Push to GitHub
2. Vercel auto-deploys frontend + backend
3. Supabase holds data
4. Visit `https://your-app.vercel.app`, paste API key from env, see tanks and alarms
