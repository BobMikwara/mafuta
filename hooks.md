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
