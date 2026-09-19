# Assumptions and open decisions

The specification files are now available on `main` and have been read. See
[spec-reconciliation.md](spec-reconciliation.md) for the gap analysis between the
specification and the code that existed before they could be read.

This document records the assumptions that remain open after that reading.

## A1. Volume representation

**Assumption**: volumes are `numeric(14,3)` litres in PostgreSQL, and will be integer
millilitres in the domain layer once the refactor in the remediation plan is done.

**Why**: TRD section 4 and the database skill both require numeric for litres. Binary
floating point accumulates error across thousands of readings, which is unacceptable for
inventory. Storing three decimal places in litres keeps the precision a tank gauge can
actually deliver.

**Status**: database side is done. Domain side still uses JavaScript `number` and is the
highest remaining data-integrity risk.

## A2. Tenant isolation model

**Assumption**: shared schema, every business table carries `tenantId`, every business query
is scoped by it, and tenant ownership is resolved server-side from the credential.

**Why**: the execution plan requires tenant scope on every business query and forbids
trusting a device-supplied tenant. The foreign keys in the baseline schema additionally make
a cross-tenant reading impossible at the database level.

**Cost to change**: high for database-per-tenant. Not currently abstracted.

## A3. Deletion model

**Assumption**: lifecycle status columns rather than hard deletion, matching TRD section 4.

**Consequence**: `onDelete: Cascade` remains on tenant-owned tables so that a compliance
driven tenant purge is still possible, but ordinary operations never delete.

**Open question**: what is the documented retention and deletion process? TRD section 4 says
readings must not be deleted without one.

## A4. Timestamps

**Assumption**: all persisted timestamps are `timestamptz` in UTC. Station timezone is
stored on the station and used only at presentation.

**Default**: `Africa/Dar_es_Salaam`, because memory.md says Tanzania first.

**Open question**: PRD section 5 says tanks are created with a timezone. Should a tank be
able to override its station timezone, or is the station the single source of truth? The
schema currently puts it on the station only, with the tank inheriting it.

## A5. Device identity and credentials

**Assumption**: devices are registered with manufacturer, model, serial number and protocol,
assigned to a tank through `device_assignments`, and authenticated with a rotatable
credential whose secret is hashed.

**Status**: schema done. Registration, assignment, and credential rotation are not built.

**Open question**: does the pilot use per-device certificates, per-device API keys, or a
shared gateway credential? The MQTT section of `mcp-and-plugins.md` asks for per-device
credentials, which suggests keys or certificates per device.

## A6. Idempotency

**Assumption**: a client-supplied idempotency key, unique per device, is required for device
submissions and optional for manual entries.

**Why**: the execution plan lists idempotency for device messages as non-negotiable.

**Consequence of the current constraint**: `idempotencyKey` is nullable, so two manual
readings with no device and no key are not deduplicated. Manual entries go through an
authenticated user, so this is acceptable. Device traffic will be required to supply a key.

## A7. Events versus alerts

**Assumption**: an event is a candidate observation requiring human decision (delivery,
unexplained decrease). An alert is an operational condition (low stock, stale data, device
offline). Events carry confidence and evidence; alerts carry severity and an
acknowledgement workflow.

**Why**: PRD section 5 separates them, and rules.md forbids automatic theft classification.
Conflating them is what produced the "possible leak or theft" wording that must be removed.

## A8. Provenance

**Assumption**: every reading carries provenance (measured, recorded, estimated, inferred,
manual), a validity status, and a freshness status computed from the station's stale
threshold.

**Why**: PRD section 3 requires a transparent distinction, and rules.md forbids presenting
stale readings as real-time.

**Open question**: which components will produce inferred values? Until volume is derived
from level, every reading is `measured`. A future delivery reconciliation would produce
`inferred` values and needs this field.

## A9. Frontend

**Assumption**: the current console is a development aid, not the product frontend. The
product frontend will be React with TypeScript per TRD section 2.

**Why**: the console exists to make the simulator visible during development.

## A10. Not started, and why

| Item                              | Blocker                                                                    |
| --------------------------------- | -------------------------------------------------------------------------- |
| Hardware protocol adapter         | No gauge model or protocol documentation. See hardware-adapter-contract.md |
| Rate limits on auth and ingestion | Needs the expected device count and deployment topology                    |
| Reconciliation report             | Needs dispenser and delivery data                                          |
| Temperature compensated volume    | Needs the regulatory definition of standard volume for Tanzania            |
| Retention and purge jobs          | Needs the retention decision above                                         |
| Billing                           | Needs a commercial decision on what is metered                             |
