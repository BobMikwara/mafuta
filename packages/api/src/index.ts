export { buildServer, type ServerDependencies, type ServerOptions } from './server.js';
export { registerAuthentication, requireScopes, currentTenantId } from './auth.js';
export { registerErrorHandler } from './errors.js';
export { registerSiteRoutes } from './routes/sites.js';
export { registerTankRoutes } from './routes/tanks.js';
export { registerAlarmRoutes } from './routes/alarms.js';
export * from './dependency-factory.js';
