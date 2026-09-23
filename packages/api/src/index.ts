export {
  buildServer,
  type HealthCredentialsState,
  type ServerDependencies,
  type ServerOptions,
} from './server.js';
export {
  registerAuthentication,
  requireScopes,
  currentTenantId,
  type AuthFailureReason,
} from './auth.js';
export {
  checkCredentialReadiness,
  createCredentialStatusReader,
  credentialProvisioningHint,
  type CredentialReadinessContext,
  type CredentialReadinessInput,
  type CredentialReadinessResult,
} from './credential-readiness.js';
export { registerErrorHandler } from './errors.js';
export { registerSessionRoutes } from './routes/session.js';
export { registerStationRoutes } from './routes/stations.js';
export { registerTankRoutes } from './routes/tanks.js';
export { registerAlertRoutes } from './routes/alerts.js';
export { registerDeviceRoutes } from './routes/devices.js';
export { registerEventRoutes } from './routes/events.js';
export { registerDashboardRoutes } from './routes/dashboard.js';
export { registerReportRoutes } from './routes/reports.js';
export { registerAuditRoutes } from './routes/audit.js';
export * from './dependency-factory.js';
