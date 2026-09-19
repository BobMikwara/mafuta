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
