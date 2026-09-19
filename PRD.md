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
