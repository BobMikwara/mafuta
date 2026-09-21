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
export { registerSiteRoutes } from './routes/sites.js';
export { registerTankRoutes } from './routes/tanks.js';
export { registerAlarmRoutes } from './routes/alarms.js';
export * from './dependency-factory.js';
