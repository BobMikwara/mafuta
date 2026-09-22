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
