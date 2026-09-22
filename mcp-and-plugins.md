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
