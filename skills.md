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
