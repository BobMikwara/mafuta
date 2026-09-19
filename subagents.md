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
