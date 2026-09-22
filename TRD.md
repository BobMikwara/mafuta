# Technical Requirements Document: FuelTrack EA

## 1. Architecture

Start with a modular monolith, with clear boundaries that can later be extracted into services. Recommended components:

- Web frontend
- API backend
- Device ingestion module
- Protocol adapter layer
- Processing and event engine
- Notification module
- PostgreSQL database
- Optional Redis-backed job queue
- Optional MQTT broker

## 2. Recommended stack

- Node.js LTS
- TypeScript strict mode
- NestJS or Fastify-based API
- React with TypeScript
- PostgreSQL
- Prisma
- Zod or equivalent validation
- Vitest/Jest for tests
- Playwright for end-to-end tests
- ESLint and Prettier
- Docker for local reproducibility
- GitHub Actions or equivalent CI
- Vercel for frontend if suitable
- Supabase PostgreSQL/Auth/Storage only where its security and operational model is understood

## 3. Domain entities

- Tenant
- User
- Role
- Station
- Tank
- Device
- DeviceAssignment
- TankReading
- RawDeviceMessage
- FuelEvent
- Delivery
- Alert
- AuditLog
- Future: Dispenser, Nozzle, PumpTransaction, PumpTotalizer, ProductMapping

## 4. Data rules

- Store timestamps as timestamptz in UTC.
- Store volume using decimal/numeric, not binary floating point for financial or inventory records.
- Retain recorded_at and received_at.
- Use immutable raw messages where possible.
- Add unique idempotency keys for device messages.
- Add indexes for tank_id + recorded_at and tenant_id + created_at.
- Use soft deletion or lifecycle status for operational entities.
- Preserve assignment history.
- Avoid deleting readings without a documented retention process.

## 5. Ingestion contract

Normalized reading:

- tenant or resolved device ownership
- station_id
- tank_id
- device_id
- message_id or idempotency_key
- recorded_at
- received_at
- volume_litres
- level_mm
- temperature_c, nullable
- water_level_mm, nullable
- quality_status
- source_protocol
- raw_message_reference

Validation:

- Reject impossible negative volumes.
- Check tank capacity and configured tolerance.
- Reject timestamps outside configured clock-skew limits or mark for review.
- Reject unknown device assignments.
- Do not trust tenant_id supplied by an untrusted device; resolve ownership server-side.

## 6. Event engine

Use rule-based, explainable processing initially.

Candidate delivery:

- Sustained positive change.
- Configured minimum volume.
- Optional delivery window.
- No contradictory data-quality condition.
- Record evidence and confidence.
- Permit manual confirmation.

Candidate unexplained decrease:

- Sustained negative change.
- Compare against recorded events and future dispenser records.
- Check station operating status.
- Check data quality and temperature.
- Generate an investigation alert, not a theft verdict.

## 7. Security

- Passwords hashed using a modern password hashing algorithm.
- MFA-ready design.
- Short-lived access tokens and secure refresh strategy.
- Role and resource-level authorization.
- Tenant scope enforced server-side.
- Device credentials rotatable and revocable.
- Rate limits on ingestion and authentication endpoints.
- No secrets in source control or frontend bundles.
- Audit privileged actions.
- Protect exports and raw payloads.

## 8. Observability

- Structured logs.
- Correlation/request IDs.
- Metrics for ingestion success, rejection, latency, stale devices, processing failures, and alert volume.
- Health and readiness endpoints.
- Error tracking with sensitive-data scrubbing.
- No console.log in committed code. Use an approved structured logger.

## 9. Deployment

- Separate development, staging, and production.
- Run migrations as a controlled release step.
- CI must run format check, lint, typecheck, unit tests, integration tests, and build.
- Use environment-specific secrets.
- Configure database backups and restoration tests.
- Deploy only from reviewed commits.
- Maintain rollback instructions.

## 10. Hardware integration

- Implement adapters behind a stable interface.
- Require vendor documentation before implementing a protocol.
- Do not infer register maps or packet formats.
- Validate hazardous-area suitability outside the software project with qualified professionals.
- Keep device-specific parsing separate from domain processing.

## 11. Performance targets for initial design

Targets must be validated during pilot:

- Dashboard should clearly indicate data freshness.
- Ingestion should be idempotent.
- Processing should tolerate duplicate and delayed messages.
- System should support at least the initial pilot fleet without architectural redesign.
- Load testing must be performed before significant scale-up.
