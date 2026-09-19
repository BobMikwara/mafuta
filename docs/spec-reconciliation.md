# Specification reconciliation

The specification files (`01-AI-EXECUTION-PLAN.md`, `PRD.md`, `TRD.md`, `MASTER-SPEC.md`,
`skills.md`, `rules.md`, `memory.md`, `hooks.md`, `subagents.md`, `mcp-and-plugins.md`,
`agent-prompt.md`) are now available on `main`. A working foundation had already been built
before they could be read, so this document records where the two disagree and what is being
done about it.

## Summary

| Area              | Spec says                                                                                                       | Foundation did                                                      | Verdict                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Database          | PostgreSQL, Prisma migrations (non-negotiable)                                                                  | In-memory repositories                                              | Fixed this increment for schema and migrations. Repository implementation is next. |
| Volume arithmetic | numeric, not binary floating point                                                                              | JavaScript `number`                                                 | Not yet fixed. Highest remaining data-integrity risk.                              |
| Entity name       | Station                                                                                                         | Site                                                                | Not yet renamed. Blocks nothing today, grows costly later.                         |
| Idempotency       | Unique key per device message (non-negotiable)                                                                  | Not implemented                                                     | Schema and constraint done. Service logic is next.                                 |
| Raw payloads      | Retained, immutable, restricted                                                                                 | Not implemented                                                     | Table done. Access control and write path are next.                                |
| Users and roles   | Users, roles, hashed passwords, MFA-ready                                                                       | API keys only                                                       | Not started. API keys remain correct for devices.                                  |
| Audit log         | Privileged actions logged                                                                                       | Not implemented                                                     | Table done. Write path is next.                                                    |
| Events            | FuelEvent with confidence, evidence, operator decision                                                          | Candidate events raised as alerts                                   | Not yet split.                                                                     |
| Theft wording     | Never classify unexplained movement as theft                                                                    | Alarm message says "possible leak or theft"                         | Not yet corrected. Wording violates the rule as written.                           |
| Alerts            | low, critical, offline, stale, probe quality, candidate events, water                                           | Similar set, different names                                        | Partially aligned.                                                                 |
| Provenance        | Distinguish measured, recorded, estimated, inferred                                                             | quality only (ok, suspect, invalid)                                 | Schema done. Code is next.                                                         |
| Rate limits       | Required on ingestion and auth                                                                                  | Not implemented                                                     | Not started.                                                                       |
| Clock skew        | Reject or mark for review                                                                                       | Not implemented                                                     | Not started.                                                                       |
| Frontend          | React with TypeScript                                                                                           | Vanilla JavaScript console                                          | Not started.                                                                       |
| Timezone default  | Tanzania first                                                                                                  | Demo used Africa/Nairobi                                            | Fixed in the schema default. Demo data is next.                                    |
| Repository layout | apps/api, apps/web, packages/shared, packages/device-contracts, services/processing, prisma, docs, tests, infra | packages/core, packages/api, apps/api-server, apps/simulator-runner | Not yet restructured. Suggested, not mandatory.                                    |

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
3. **Ingestion hardening**: idempotency keys, raw payload retention with restricted read
   access, clock-skew policy, capacity tolerance, and rate limits.
4. **Events and alerts**: split `FuelEvent` from `Alert`, add confidence and evidence, add
   operator confirm and reject, and remove the theft wording.
5. **Identity**: users, roles, hashed passwords, short-lived tokens, station scopes, and
   audit logging on privileged actions.
6. **Persistence**: implement the `Repositories` ports on Prisma, keep the in-memory
   implementation for unit tests, and add integration tests against PostgreSQL.
7. **Frontend**: replace the vanilla console with React and TypeScript, showing freshness,
   quality, and permission states.
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
