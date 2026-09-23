# Specification reconciliation

The specification files (`01-AI-EXECUTION-PLAN.md`, `PRD.md`, `TRD.md`, `MASTER-SPEC.md`,
`skills.md`, `rules.md`, `memory.md`, `hooks.md`, `subagents.md`, `mcp-and-plugins.md`,
`agent-prompt.md`) are now available on `main`. A working foundation had already been built
before they could be read, so this document records where the two disagree and what is being
done about it.

## Summary

| Area              | Spec says                                                                                                       | Foundation did                                                      | Verdict                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Database          | PostgreSQL, Prisma migrations (non-negotiable)                                                                  | In-memory repositories                                              | Fixed this increment for schema and migrations. Repository implementation is next.   |
| Volume arithmetic | numeric, not binary floating point                                                                              | JavaScript `number`                                                 | Not yet fixed. Highest remaining data-integrity risk.                                |
| Entity name       | Station                                                                                                         | Site                                                                | Not yet renamed. Blocks nothing today, grows costly later.                           |
| Idempotency       | Unique key per device message (non-negotiable)                                                                  | Not implemented                                                     | Done. Derived or client supplied key, enforced in the service and by a unique index. |
| Raw payloads      | Retained, immutable, restricted                                                                                 | Not implemented                                                     | Table done. Access control and write path are next.                                  |
| Users and roles   | Users, roles, hashed passwords, MFA-ready                                                                       | API keys only                                                       | Not started. API keys remain correct for devices.                                    |
| Audit log         | Privileged actions logged                                                                                       | Not implemented                                                     | Table done. Write path is next.                                                      |
| Events            | FuelEvent with confidence, evidence, operator decision                                                          | Candidate events raised as alerts                                   | Not yet split.                                                                       |
| Theft wording     | Never classify unexplained movement as theft                                                                    | Alarm message says "possible leak or theft"                         | Not yet corrected. Wording violates the rule as written.                             |
| Alerts            | low, critical, offline, stale, probe quality, candidate events, water                                           | Similar set, different names                                        | Partially aligned.                                                                   |
| Provenance        | Distinguish measured, recorded, estimated, inferred                                                             | quality only (ok, suspect, invalid)                                 | Schema done. Code is next.                                                           |
| Rate limits       | Required on ingestion and auth                                                                                  | Not implemented                                                     | Not started.                                                                         |
| Clock skew        | Reject or mark for review                                                                                       | Not implemented                                                     | Not started.                                                                         |
| Frontend          | React with TypeScript                                                                                           | Vanilla JavaScript console                                          | Operator console is React. It creates and edits stations and tanks through `/v1`.    |
| Timezone default  | Tanzania first                                                                                                  | Demo used Africa/Nairobi                                            | Fixed in the schema default. Demo data is next.                                      |
| Repository layout | apps/api, apps/web, packages/shared, packages/device-contracts, services/processing, prisma, docs, tests, infra | packages/core, packages/api, apps/api-server, apps/simulator-runner | Not yet restructured. Suggested, not mandatory.                                      |

## Decisions taken deliberately

**Fastify over NestJS.** `memory.md` lists this as an open decision. Fastify is named as an
acceptable option in TRD section 2. It was already in place and it keeps the boundary thin.
Reversible, but it would mean rewriting `packages/api`.

**PGlite for migration tests.** The migration tests run against real PostgreSQL without a
server or Docker, because `@electric-sql/pglite` is PostgreSQL compiled to WebAssembly. This
means the data rules are verified on every commit with no infrastructure. The trade-off is a
development dependency that is only used by tests.

**No hand-written migration drift.** The baseline SQL is committed, and CI compares the
committed migrations against `schema.prisma` using `prisma migrate diff --exit-code`. If the
two ever disagree, CI fails rather than silently drifting.

## Ordered remediation plan

1. **Data integrity**: move volumes to integer millilitres in the domain and `numeric` in
   PostgreSQL. Highest risk item. Nothing else about inventory is trustworthy until this
   is done.
2. **Rename Site to Station** across the domain, API, and database, while the surface is
   still small.
3. **Ingestion hardening**: ~~idempotency keys~~ done, raw payload retention with restricted
   read access, clock-skew policy, capacity tolerance, and rate limits.
4. **Events and alerts**: split `FuelEvent` from `Alert`, add confidence and evidence, add
   operator confirm and reject, and remove the theft wording.
5. **Identity**: users, roles, hashed passwords, short-lived tokens, station scopes, and
   audit logging on privileged actions.
6. **Persistence**: implement the `Repositories` ports on Prisma, keep the in-memory
   implementation for unit tests, and add integration tests against PostgreSQL.
7. **Frontend**: ~~replace the vanilla console with React and TypeScript~~ done for the
   operator console. It shows freshness, quality, source and the scopes returned by
   `/v1/session`. Users, passwords and MFA remain in step 5.
8. **Pilot readiness**: observability, backups, security review, deployment automation.

## Open questions for the product owner

These block or materially affect the work above.

1. **PostgreSQL hosting.** With a budget of roughly USD 500 to 1,000, where will the
   database live? Supabase, Neon, a managed instance, or self-hosted? This decides whether
   the connection uses pooling and whether migrations run in CI against a real instance.
2. **NestJS or Fastify.** Confirm Fastify, or ask for NestJS before `apps/web` exists.
3. **Repository layout.** Adopt the suggested structure from the execution plan, or keep
   the current one? Renaming is cheap now and annoying later.
4. **Hardware.** Which gauge, and is the protocol documentation available? Everything in
   step 10 of the delivery sequence waits on this.
5. **Retention.** How long must readings and raw payloads be kept? This drives the
   partitioning strategy for `tank_readings`.
6. **MVP tenant count.** How many companies and stations must the first pilot support?
   This decides whether the current single-process assumptions hold.

## Increment log

### Idempotent ingestion (done)

A replayed device upload used to create a second reading, which the alarm rules would read as
a genuine drop in the fuel ledger. Every submission now carries an identity:

- the client may send `idempotencyKey` (8 to 200 printable characters, no whitespace);
- otherwise the platform derives one with SHA-256 over tenant, tank, device and the
  observation instant, so an unkeyed retry collapses onto the original reading too;
- `IngestService` resolves the key before writing and returns the stored reading with
  `duplicate: true`, without re-running the alarm rules;
- the HTTP route answers 201 when a reading was stored and 200 when it was a replay;
- `tank_readings.idempotencyKey` is now `NOT NULL` and unique per
  `(tenantId, idempotencyKey)` (migration `0002_idempotency_key`). The unique moved from
  `(deviceId, idempotencyKey)` because PostgreSQL treats NULL as distinct, so the old index
  could not protect a manual dip recorded without a device.

Tests: `packages/core/test/idempotency.test.ts`, the `ingest idempotency` block in
`packages/core/test/ingest-service.test.ts`, the `reading ingestion idempotency` block in
`packages/api/test/api.test.ts`, and `prisma/test/idempotency-migration.test.ts`, which
applies both migrations to real PostgreSQL.

### Console alert route (done)

The consoles answered `404 {"error":"not_found","message":"No route matches this request"}`
the moment an API key was connected, because they polled `GET /v1/alarms` while the v1
surface registers alerts at `GET /v1/alerts` (PRD section 5 names the feature "Alerts").
The stale path shipped with the React console rewrite and also lived in the vanilla
console and in this document's own wiring notes. Both consoles now read `GET /v1/alerts`
and the `{ alerts }` envelope, `apps/web` types the response as `Alert` and tanks carry
`stationId`, and `packages/api/test/console-contract.test.ts` replays the exact requests
the consoles issue (from the exported `CONSOLE_REQUESTS` constant) against a real server,
so a rename on either side fails CI instead of the connection panel. The credentials CLI
gained `revoke` so a key can be retired: rotation is provision, update callers, revoke.

### Operator console create and edit (done in the app, not yet redeployed)

Adding a station or a tank failed in the shipped console because that console never
sent a create request. It polled tanks, readings and alerts and had no form, no
`POST /v1/stations` and no `POST /v1/tanks`. The API already accepted those writes.
Keys issued before the site rename can still store `sites:write`. Authentication
maps that name onto `stations:write`, so a create is not refused while migration
`0004_rename_legacy_scopes` is waiting to rewrite the stored rows. A 403 that is a
real missing scope names `requiredScopes` instead of returning an empty forbidden
error.

The React console now:

- signs in with `GET /v1/session` and keeps the key in the browser tab only;
- creates and edits stations (`POST` and `PATCH /v1/stations`) and tanks
  (`POST` and `PATCH /v1/tanks`) with the same field set the schemas already accept;
- rejects a non-positive capacity and a capacity above the declared cylinder before
  the request is sent, and shows the API's field issues if the server still rejects it;
- refreshes the list and opens the created record only after a 201;
- labels simulated and manual readings, and treats a missing reading as missing;
- covers stations, tanks, devices, readings, deliveries, reconciliation, alerts,
  reports and settings. A route that is not implemented is a not-found page, not a
  fake screen.

`packages/api/test/console-create.test.ts` posts the drawer bodies through
`createHarness` and reads the station and tank back, including a cross-tenant 404.
That proves the save path in process. It does not prove the currently deployed
Vercel project: that host is behind the platform's access check, so this increment
does not claim a production create succeeded. The SPA fallback in `vercel.json`
sends client routes to `index.html` and leaves `/v1`, `/healthz`, `/public` and
`/assets` on their existing destinations, so a refresh of `/stations` does not turn
an API call into HTML. That rewrite takes effect on the next deploy.
