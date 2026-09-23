# FuelTrack EA

Multi-tenant fuel tank monitoring platform for East Africa. Vendor-agnostic core,
tenant-isolated HTTP API, deterministic tank simulator, and a rule-based alarm engine.

## Status

Foundation phase. Working, tested, and runnable locally. **Not production ready**:
persistence is in-memory, there is no rate limiting, and no hardware adapter exists yet.

| Area                                        | State                                                |
| ------------------------------------------- | ---------------------------------------------------- |
| Domain model and geometry maths             | Done, tested                                         |
| Tank simulator (deterministic, 7 scenarios) | Done, tested                                         |
| Alarm rules engine                          | Done, tested                                         |
| Tenant isolation (repositories and HTTP)    | Done, tested with cross-tenant cases                 |
| Validation of all external input            | Done, tested                                         |
| API key authentication and scopes           | Done, tested                                         |
| Idempotent ingestion                        | Done, tested in the service, HTTP and database       |
| HTTP API (Fastify)                          | Done, tested                                         |
| Simulator runner CLI                        | Done, tested                                         |
| Dashboard                                   | Read-only, development use                           |
| Prisma schema and migrations                | Done, both migrations verified against PostgreSQL 18 |
| Durable persistence                         | Not started, ports are ready                         |
| Hardware gauge adapter                      | Blocked, waiting on protocol documentation           |
| Rate limiting                               | Not started                                          |

## Layout

```
packages/core     Domain, ports, validation, simulator, alarm rules. No infrastructure deps.
packages/api      Fastify HTTP edge: auth, tenant binding, routing, error mapping.
apps/api-server   Runnable server with environment driven config.
apps/simulator-runner   CLI that pushes synthetic readings through the public API.
prisma/           schema.prisma, migrations, and migration tests.
infra/            docker-compose for local PostgreSQL.
docs/             Assumptions, reconciliation, and the hardware adapter contract.
scripts/          Guardrail enforcement for the coding standards.
```

## Database

PostgreSQL with Prisma. `prisma/schema.prisma` is the source of truth and covers every
entity named in TRD section 3.

```bash
docker compose -f infra/docker-compose.yml up -d
export DATABASE_URL="postgresql://fueltrack:fueltrack@localhost:5432/fueltrack_dev?schema=public"
npm run db:generate
npm run db:deploy
npm run db:test      # migration tests, run against PostgreSQL with no server required
```

See [prisma/README.md](prisma/README.md) for the change, rollback, and drift-check workflow.

## Continuous integration

The GitHub Actions definition lives at [docs/ci/github-actions-ci.yml](docs/ci/github-actions-ci.yml)
rather than in `.github/workflows`, because the automation account that maintains this branch
is not permitted to create or update workflow files. Copy it to `.github/workflows/ci.yml` to
enable CI. It runs two jobs: `verify` (guardrails, typecheck, lint, format, coverage, build) and
`database` (real PostgreSQL services for `db:validate`, `db:deploy`, `db:drift`, `db:test`).

## Specification alignment

The specification files on `main` were read after the first increment was built.
[docs/spec-reconciliation.md](docs/spec-reconciliation.md) lists every disagreement and the
ordered plan to close it. The two that matter most:

- **Volume arithmetic is still binary floating point in the domain layer.** The database is
  correct (`numeric`), the TypeScript is not. Do not trust inventory figures until this is
  fixed.
- **The word "Site" is used where the specification says "Station".** Being renamed.

## Quick start

```bash
npm install
npm run check          # guardrails, typecheck, lint, format, tests with coverage

# Terminal 1: start the API with demo data
FUELTRACK_SEED_DEMO=true FUELTRACK_DEV_API_KEY=local-development-key PORT=3000 \
  npm run build --workspace @fueltrack/api-server && node apps/api-server/dist/index.js

# Terminal 2: push simulated readings at one tank
node apps/simulator-runner/dist/index.js \
  --api-url http://localhost:3000 --api-key local-development-key \
  --tank-id <tank-id-from-GET-/v1/tanks> --interval-seconds 10 --scenario nominal
```

Open `http://localhost:3000` for the console and paste the API key.

## Scope note

The specification files (`PRD.md`, `TRD.md`, `01-AI-EXECUTION-PLAN.md`, `MASTER-SPEC.md`,
`skills.md`, `rules.md`, `memory.md`, `hooks.md`, `subagents.md`, `mcp-and-plugins.md`,
`agent-prompt.md`) are on `main` and have been read. The first increment was built before
they were available, so [docs/spec-reconciliation.md](docs/spec-reconciliation.md) records
where the code and the specification disagree and the order in which that is being closed.

Coding standards from `rules.md` are enforced automatically by `npm run guardrails`:
no `console.log`, no emoji, no em dashes, and no purple hues in source, styles, or
documentation.

## API keys

Every `/v1` route requires a stored API key, so a deployment whose credential store is
empty rejects every request with the same 401 a wrong key produces. Provisioning is
therefore explicit and verifiable:

```bash
npm run build
npm run key:provision -- --tenant demo-tenant --name console   # prints the key once
cat key.txt | npm run key:verify -- --tenant demo-tenant       # is this key accepted here?
npm run key:list -- --tenant demo-tenant                       # what is provisioned (no key material)
npm run key:revoke -- --tenant demo-tenant --key-id <id>       # retire a key during rotation
```

`GET /healthz` reports the credential store (`ready`, `empty`, `unavailable`) and answers
503 while it is not `ready`, so an unprovisioned deployment cannot pass as a healthy one.
With `FUELTRACK_REQUIRE_CREDENTIALS=true` (the default) the API server refuses to start at
all when nothing is provisioned. See
[docs/api-key-provisioning.md](docs/api-key-provisioning.md) for the remediation steps, the
environment reference and the security properties.

## Security notes

- The tenant of a request is derived only from a hashed API key. Client supplied tenant
  headers are ignored.
- Repositories require an explicit tenant id and re-assert ownership on every read and
  write. A mismatch raises a critical security event and returns a generic error.
- Only credentials holding the `simulator:write` scope may submit readings tagged as
  simulated, so synthetic data cannot be passed off as a device measurement.
- Errors returned to callers never include internal detail, only a request id.

See [docs/assumptions.md](docs/assumptions.md) for the full list of open decisions.
