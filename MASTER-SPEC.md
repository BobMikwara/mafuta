# FuelTrack EA - Complete AI Build Specification

This single file consolidates the project execution plan, product requirements, technical requirements, AI skills, rules, memory, hooks, subagents, MCP/plugin plan, and master agent prompt.

---

# SOURCE FILE: 01-AI-EXECUTION-PLAN.md

# FuelTrack EA - AI Execution Plan

## Mission

Build a commercially deployable, multi-tenant fuel tank monitoring SaaS platform for Tanzania first and East Africa later. Initial scope is tank monitoring only, with an extensible architecture for future fuel dispenser and POS integration.

## Product principles

- Hardware-vendor agnostic.
- Security and tenant isolation by default.
- Measurement limitations must be explicit.
- Do not claim exact sales when only inferred from tank movements.
- Prefer modular, testable code.
- Build a simulator before real hardware integration.
- Never treat stale readings as live.
- Use UTC in storage and convert to tenant/station timezone at presentation.
- No emojis in the codebase.
- Avoid purple hues in the frontend.
- No em dashes in documentation, UI copy, comments, or code.
- Never commit console.log, debug prints, secrets, credentials, or temporary files.
- Always test before deployment.
- Prefer small modules over mega-files.

## Delivery sequence

1. Establish repository and development standards.
2. Build architecture and domain model.
3. Implement authentication, authorization, tenants, stations, tanks, devices, and assignments.
4. Implement normalized reading ingestion.
5. Implement simulator.
6. Implement historical readings and live dashboard.
7. Implement event detection with explainable rules.
8. Implement alerts and acknowledgements.
9. Implement reports and exports.
10. Add hardware adapters only after protocol documentation is available.
11. Add pilot readiness, observability, backups, security review, and deployment automation.
12. Add dispenser/POS integration behind a separate bounded module.

## AI operating procedure

For every task:

1. Read all applicable rules, PRD, TRD, skills, and memory files.
2. Inspect the existing repository before changing anything.
3. State assumptions and identify unknowns.
4. Make the smallest coherent change.
5. Add or update tests.
6. Run formatting, linting, type checking, unit tests, integration tests, and build where applicable.
7. Review for security, tenant isolation, stale data, and data integrity.
8. Summarize changed files, tests run, results, and remaining risks.
9. Never silently invent device protocols or regulatory claims.

## Non-negotiable technical constraints

- TypeScript with strict mode.
- PostgreSQL as primary relational database.
- Prisma migrations.
- API input validation using a schema validation library.
- Authenticated device ingestion.
- Idempotency for device messages.
- Raw payload retention with restricted access.
- Every business query must enforce tenant scope.
- Audit logs for privileged actions.
- Secure secrets through environment variables or a managed secret store.
- No production deployment with failing checks.
- Database migrations must be reversible or have a documented rollback plan.

## Suggested initial repository

- apps/api
- apps/web
- packages/shared
- packages/config
- packages/device-contracts
- services/processing
- prisma
- docs
- tests
- infra

## Definition of done

A feature is complete only when:

- Acceptance criteria are met.
- Tests cover normal and failure paths.
- Authorization and tenant isolation are tested.
- Documentation is updated.
- No prohibited patterns are introduced.
- CI checks pass.
- Deployment impact is documented.

---

# SOURCE FILE: PRD.md

# Product Requirements Document: FuelTrack EA

## 1. Product overview

FuelTrack EA is a multi-tenant SaaS platform for monitoring fuel levels in petrol-station tanks. It will initially ingest tank readings from a simulator and later from multiple hardware vendors. It will support Tanzania first and be configurable for East African markets.

## 2. Users

- Platform administrator
- Company administrator
- Station manager
- Station operator
- Auditor/read-only user
- Future: installation technician and support agent

## 3. Goals

- Display current tank inventory.
- Retain historical readings.
- Show data freshness and device health.
- Detect possible deliveries and unexplained stock changes.
- Generate alerts.
- Support multiple companies and stations.
- Preserve a future path to dispenser/POS integration.
- Provide transparent distinction between measured, recorded, estimated, and inferred values.

## 4. Non-goals for MVP

- Exact pump sales integration.
- Automated regulatory or tax reporting.
- Automatic declaration of theft.
- Unverified support for any named hardware brand.
- Fully autonomous calibration.
- Payment processing.
- Predictive analytics before reliable historical data exists.

## 5. MVP functional requirements

### Tenant and access management

- Create, update, suspend, and view tenants.
- Create stations under a tenant.
- Create users and assign roles.
- Restrict all tenant users to authorized tenant resources.
- Support station-level permissions where required.
- Record privileged actions in audit logs.

### Tank management

- Create tanks with product type, capacity, station, and timezone.
- Assign a device or probe to a tank.
- Track assignment history.
- Configure low-stock and critical-stock thresholds.
- Support calibration metadata without pretending calibration is validated.

### Device management

- Register devices with manufacturer, model, serial number, protocol, and status.
- Track last-seen time and connection health.
- Support multiple protocol adapters.
- Permit simulated devices.
- Store raw messages securely.
- Reject unauthorized or incorrectly assigned device data.

### Reading ingestion

- Accept normalized readings through authenticated ingestion.
- Validate timestamp, volume, level, temperature, water level, and quality fields.
- Handle duplicate messages idempotently.
- Preserve device timestamp and server receipt timestamp.
- Mark stale, invalid, delayed, and estimated readings.
- Support HTTP and MQTT adapter patterns where compatible with hardware.

### Dashboard

- Show tenant, station, and tank summaries.
- Show current volume, capacity, fill percentage, last reading time, and quality.
- Clearly display stale or unavailable readings.
- Show historical graphs.
- Show device online/offline state.
- Support responsive desktop and mobile layouts.
- Avoid purple hues and avoid emoji-based status indicators.

### Events and inventory

- Detect candidate delivery events using sustained increases and contextual checks.
- Detect candidate unexplained decreases.
- Store event confidence, evidence, and status.
- Allow operator confirmation, rejection, and notes.
- Calculate inventory using documented formulas.
- Never label an event as theft without human investigation and evidence.

### Alerts

- Low stock.
- Critical stock.
- Device offline.
- Stale data.
- Probe quality issue.
- Candidate delivery.
- Candidate unexplained decrease.
- Water-level warning where supported.
- Alert acknowledgement, assignment, resolution, and audit trail.

### Reporting

- Current inventory.
- Historical inventory.
- Delivery candidates and confirmed deliveries.
- Reconciliation report.
- Device health report.
- Alert history.
- CSV export with access control and audit logging.

## 6. Future requirements

- Dispensers, nozzles, pump totalizers, and POS transactions.
- Product-to-tank mapping.
- Exact sales reconciliation where source data is available.
- Mobile application.
- Billing and subscriptions.
- Customer API.
- Multi-country configuration.
- Advanced analytics.

## 7. Non-functional requirements

- Strong tenant isolation.
- Secure authentication and authorization.
- TLS for network communication.
- Observability and structured logging without secrets.
- Automated backups.
- Graceful handling of network outages.
- Idempotent ingestion.
- Scalable time-series storage strategy.
- Accessibility and responsive UI.
- Clear data retention and deletion policies.

## 8. Acceptance principles

- No feature is accepted without tests.
- No live status is shown without a freshness indicator.
- Calculated values show their formula and source where practical.
- Device-specific assumptions are documented.
- A pilot must compare readings against trusted reference measurements.

---

# SOURCE FILE: TRD.md

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

---

# SOURCE FILE: skills.md

# AI Engineering Skills for FuelTrack EA

## General workflow

- Read the task, PRD, TRD, rules, and memory before coding.
- Inspect existing files and follow established patterns.
- Ask for clarification only when an unknown blocks safe implementation.
- Do not invent hardware protocols, regulatory requirements, or API behavior.
- Prefer incremental commits and small pull requests.

## Backend skill

- Use TypeScript strict mode.
- Keep controllers thin.
- Put business logic in services/use cases.
- Validate all external input.
- Use typed DTOs and explicit error handling.
- Enforce tenant authorization in service and data-access layers.
- Use transactions for related inventory and event writes.
- Make ingestion idempotent.

## Frontend skill

- Use reusable components.
- Keep data fetching separate from presentation.
- Show loading, empty, error, stale, and permission states.
- Do not use purple as a primary visual theme.
- Do not use emoji status indicators.
- Use accessible labels, keyboard navigation, and sufficient contrast.
- Avoid exposing secrets or internal IDs unnecessarily.

## Database skill

- Use migrations.
- Add indexes based on query patterns.
- Use numeric/decimal for litres and monetary values.
- Preserve historical records.
- Add constraints where possible.
- Test tenant isolation with adversarial cases.

## Testing skill

- Write tests before or alongside implementation.
- Test happy paths and failure paths.
- Test duplicate messages and delayed messages.
- Test unauthorized cross-tenant access.
- Test invalid device data.
- Test stale readings.
- Test delivery and unexplained-decrease rules.
- Run all relevant checks before claiming completion.

## Documentation skill

- Document assumptions.
- Document formulas.
- Distinguish measured, recorded, estimated, and inferred values.
- Include operational runbooks for failures.
- Avoid em dashes.
- Do not include secrets, personal data, or unsupported claims.

## Security skill

- Treat all device payloads as untrusted.
- Never log tokens, passwords, full raw secrets, or sensitive personal data.
- Use secure defaults.
- Review authorization on every new endpoint.
- Use dependency scanning and update vulnerable packages.

---

# SOURCE FILE: rules.md

# Repository Rules

## Mandatory

- No emojis in the codebase, comments, documentation, commit messages, or UI copy.
- Refrain from purple hues in the frontend.
- Always test code before deployment.
- Prioritize modular code over mega-files.
- Never commit console.logs, debug prints, secrets, credentials, or API keys.
- Do not use em dashes.
- Use TypeScript strict mode.
- Use UTC for persisted timestamps.
- Validate every external input.
- Enforce tenant isolation server-side.
- Do not invent vendor protocols or hardware capabilities.
- Do not classify unexplained movement as theft automatically.
- Do not represent stale readings as real-time.
- Do not deploy with failing CI checks.
- Keep raw device messages restricted and protected.
- Use meaningful names and small functions.
- Update documentation when behavior or contracts change.

## Code review checklist

- Is the change modular?
- Are inputs validated?
- Are permissions enforced?
- Are tests included?
- Are errors handled?
- Are logs structured and scrubbed?
- Could duplicate or delayed messages break it?
- Could one tenant access another tenant's data?
- Does the UI show freshness and uncertainty?
- Does the change preserve future dispenser integration?

---

# SOURCE FILE: memory.md

# Project Memory

## Product context

- Project name: FuelTrack EA, working name.
- Market: Tanzania first, then East Africa.
- Initial product: tank monitoring.
- Future product: dispenser and POS integration.
- User has basic programming knowledge.
- Preferred backend ecosystem: Node.js.
- Initial budget: approximately USD 500 to 1,000.
- No hardware has been purchased.
- Hardware must be vendor-agnostic.
- Initial development should use a simulator.

## Product decisions

- Use a modular monolith initially.
- Use TypeScript.
- Use PostgreSQL and Prisma.
- Keep protocol adapters separate from business logic.
- Treat readings as measured data and event calculations as inference.
- Make data freshness visible.
- Build for multi-tenancy from the beginning.

## Open decisions

- Exact hardware vendor and model.
- Whether to use NestJS or Fastify.
- Whether MQTT is needed for the first hardware gateway.
- Cloud provider and hosting costs.
- Exact retention periods.
- Local regulatory and installation requirements.
- Commercial pricing.
- Dispenser/POS vendor integrations.

## Working preferences

- No emojis.
- No purple hues in frontend.
- No em dashes.
- No console.log in committed code.
- Always test before deployment.
- Prefer modular code.

---

# SOURCE FILE: hooks.md

# Hooks and Automation

These are recommended hooks. Implement them using the selected agent framework or repository tooling.

## Pre-commit

Run:

1. Secret scan.
2. Formatting check.
3. ESLint.
4. TypeScript typecheck.
5. Fast unit tests.
6. Check for console.log and debug prints.
7. Check for emojis and em dashes in source and documentation if the repository policy requires it.

Reject the commit if any mandatory check fails.

## Pre-push

Run:

1. Full unit tests.
2. Integration tests.
3. Prisma schema validation.
4. Build frontend and backend.
5. Dependency vulnerability check where configured.

## Pre-deploy

Run:

1. CI status verification.
2. Database migration review.
3. Environment variable verification without printing secret values.
4. Build artifact verification.
5. Smoke tests.
6. Rollback plan verification.
7. Confirm backups and monitoring.

## Post-deploy

Run:

1. Health check.
2. Readiness check.
3. Database connectivity check.
4. Ingestion test using a non-production test device or fixture.
5. Review error rate and latency.
6. Confirm no unexpected cross-tenant access.

---

# SOURCE FILE: subagents.md

# Subagent Roles

Use specialized subagents when the agent framework supports them. Each subagent must return evidence, changed files, tests, and unresolved risks.

## Architect

Responsibilities:

- Maintain system boundaries.
- Review tradeoffs.
- Protect future dispenser integration.
- Identify assumptions and risks.
  Must not:
- Invent hardware protocol details.

## Backend Engineer

Responsibilities:

- Implement API, services, validation, authorization, and persistence.
- Add unit and integration tests.

## Frontend Engineer

Responsibilities:

- Implement accessible responsive UI.
- Show loading, error, stale, and permission states.
- Follow visual rules, including no purple hues and no emojis.

## Device Integration Engineer

Responsibilities:

- Implement protocol adapters only from supplied documentation.
- Normalize payloads.
- Test malformed, duplicate, delayed, and unsupported messages.

## Data and Inventory Engineer

Responsibilities:

- Implement stock calculations and explainable event rules.
- Document assumptions and limitations.
- Avoid unverified theft conclusions.

## QA Engineer

Responsibilities:

- Create acceptance tests.
- Test tenant isolation.
- Test failures, retries, duplicates, stale data, and permissions.
- Run regression tests.

## Security Reviewer

Responsibilities:

- Review auth, tenant isolation, secrets, raw payload access, exports, and dependency risks.
- Provide prioritized findings.

## DevOps Engineer

Responsibilities:

- Create local development setup.
- Configure CI/CD, environments, backups, observability, and rollback documentation.

---

# SOURCE FILE: mcp-and-plugins.md

# MCP and Plugin Integration Plan

## Principles

- Connect only services required for the current task.
- Use least-privilege permissions.
- Never give an AI agent unrestricted production write access.
- Prefer separate development and staging projects.
- Keep production credentials unavailable to coding agents where possible.
- Review every external action before enabling autonomous execution.
- Do not place secrets in repository files.

## Supabase

Potential uses:

- Managed PostgreSQL.
- Authentication, if selected.
- Storage for reports or documents.
- Database inspection during development.

Recommended setup:

1. Create separate development, staging, and production Supabase projects.
2. Use a restricted development key for agents.
3. Never expose service-role keys to the frontend.
4. Keep migrations in version control.
5. Prefer read-only database inspection for analysis agents.
6. Require human approval for destructive schema changes.
7. Enable backups and test restoration.
8. Configure Row Level Security if Supabase client access is used. Do not assume RLS replaces server-side authorization.

## Vercel

Potential uses:

- Host the React/Next.js frontend.
- Preview deployments for pull requests.
- Environment variable management.
- Deployment status checks.

Recommended setup:

1. Connect only the repository and required project.
2. Use preview environments for AI-generated changes.
3. Keep production deployment approval-gated.
4. Store secrets in Vercel environment settings.
5. Do not allow an agent to alter production domains or billing settings without approval.
6. Verify server-side API and database security separately from frontend hosting.

## GitHub

Potential uses:

- Repository access.
- Pull requests.
- Issues.
- CI status.

Recommended permissions:

- Read repository by default.
- Create branches and pull requests if needed.
- Avoid direct pushes to protected branches.
- Require reviews and passing checks.

## Sentry or equivalent

Potential uses:

- Error monitoring.
- Release health.

Rules:

- Scrub personal data and secrets.
- Do not send raw device payloads unless explicitly sanitized.
- Use separate projects for environments.

## MQTT broker

Potential uses:

- Device message ingestion.
- Topic-based routing.

Rules:

- Use per-device credentials or certificates.
- Restrict publish and subscribe topics.
- Use TLS.
- Prevent wildcard access where possible.
- Keep broker administration separate from application users.

## Plugin and MCP selection checklist

Before connecting a service, document:

- Service name.
- Purpose.
- Required permissions.
- Data accessed.
- Write actions.
- Environment.
- Human approval requirements.
- Credential rotation plan.
- Revocation procedure.

## Important

MCP server names and capabilities vary by provider and may change. Verify the official, current documentation before installing or authorizing a connector. Do not assume a generic Supabase or Vercel MCP server has a particular tool or permission.

---

# SOURCE FILE: agent-prompt.md

# Master Prompt for the Coding AI

You are the lead engineer for FuelTrack EA, a commercial multi-tenant fuel tank monitoring platform.

Read these files before acting:

- 01-AI-EXECUTION-PLAN.md
- PRD.md
- TRD.md
- skills.md
- rules.md
- memory.md
- hooks.md
- subagents.md
- mcp-and-plugins.md

Your responsibilities:

1. Build the system incrementally.
2. Inspect the repository before changing it.
3. Never invent hardware protocol details.
4. Keep the architecture vendor-agnostic.
5. Start with a tank simulator.
6. Use TypeScript and modular design.
7. Enforce tenant isolation.
8. Validate all external input.
9. Add tests for every meaningful change.
10. Run all applicable checks before reporting completion.
11. Report assumptions, changed files, tests, results, and risks.
12. Never claim a feature works unless it was tested.
13. Never deploy directly to production without explicit human approval.
14. Never use emojis, purple hues, console.log, or em dashes in the codebase.
15. Preserve room for future dispenser and POS integration.

When a task is ambiguous:

- Identify the ambiguity.
- Choose the safest reversible option if it does not affect security, money, hardware safety, or data integrity.
- Ask for clarification when the ambiguity could create material risk.

When a task concerns hardware:

- Request the exact model and protocol documentation.
- Build a mock or adapter contract if documentation is unavailable.
- Clearly label simulated behavior.

Response format after each implementation task:

- Summary
- Files changed
- Tests run
- Test results
- Security and tenant-isolation review
- Known limitations
- Suggested next task
