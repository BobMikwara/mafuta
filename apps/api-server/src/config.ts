import { toStationId, toTenantId, type StationId, type TenantId } from '@fueltrack/core';

/**
 * Environment driven configuration. Every value has a safe default and invalid
 * values fail fast at startup rather than at request time.
 */
export interface ApiServerConfig {
  readonly host: string;
  readonly port: number;
  readonly minLogLevel: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  readonly requestLogging: boolean;
  readonly seedDemo: boolean;
  /**
   * Applies `prisma/migrations` at startup when persistence is Postgres. Off by
   * default so migrating stays an explicit operator decision.
   */
  readonly autoMigrate: boolean;
  /**
   * Refuses to start when the credential store holds no usable API key. On by
   * default: a server that rejects every request because nothing was ever
   * provisioned looks exactly like a server with a bad key, and that ambiguity
   * is what this flag removes. Set FUELTRACK_REQUIRE_CREDENTIALS=false to allow
   * a credential-less start (for example while bootstrapping a new tenant).
   */
  readonly requireCredentials: boolean;
  /** Supplied by the operator. Never logged, never echoed to the dashboard. */
  readonly devApiKey: string | null;
  readonly demoTenantId: TenantId;
  readonly dashboardDir: string | null;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'critical'] as const;

function readLogLevel(raw: string | undefined): ApiServerConfig['minLogLevel'] {
  if (raw === undefined || raw === '') {
    return 'info';
  }
  if (!(LOG_LEVELS as ReadonlyArray<string>).includes(raw)) {
    throw new ConfigurationError(`FUELTRACK_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  }
  return raw as ApiServerConfig['minLogLevel'];
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return 3000;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigurationError('PORT must be an integer between 1 and 65535');
  }
  return port;
}

/**
 * Strict boolean reader. A typo such as `flase` is rejected instead of being
 * silently treated as the default, because the defaults here decide whether a
 * deployment may serve traffic without a credential.
 */
function readBoolean(raw: string | undefined, name: string, fallback: boolean): boolean {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new ConfigurationError(`${name} must be "true" or "false"`);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiServerConfig {
  const seedDemo = env['FUELTRACK_SEED_DEMO'] === 'true';
  const devApiKey = env['FUELTRACK_DEV_API_KEY']?.trim() ?? '';
  const tenantRaw = env['FUELTRACK_DEMO_TENANT_ID']?.trim() ?? 'demo-tenant';

  if (seedDemo && devApiKey.length < 16) {
    throw new ConfigurationError(
      'FUELTRACK_SEED_DEMO=true requires FUELTRACK_DEV_API_KEY with at least 16 characters. The key is supplied by the operator and is never logged.',
    );
  }

  let demoTenantId: TenantId;
  try {
    demoTenantId = toTenantId(tenantRaw);
  } catch {
    throw new ConfigurationError(
      'FUELTRACK_DEMO_TENANT_ID must be a lowercase alphanumeric identifier',
    );
  }

  return {
    host: env['HOST']?.trim() || '0.0.0.0',
    port: readPort(env['PORT']),
    minLogLevel: readLogLevel(env['FUELTRACK_LOG_LEVEL']),
    requestLogging: env['FUELTRACK_REQUEST_LOGGING'] !== 'false',
    seedDemo,
    autoMigrate: env['FUELTRACK_AUTO_MIGRATE'] === 'true',
    requireCredentials: readBoolean(
      env['FUELTRACK_REQUIRE_CREDENTIALS'],
      'FUELTRACK_REQUIRE_CREDENTIALS',
      true,
    ),
    devApiKey: devApiKey.length === 0 ? null : devApiKey,
    demoTenantId,
    dashboardDir: env['FUELTRACK_DASHBOARD_DIR']?.trim() || null,
  };
}

/**
 * Station created by the demo seed. Stable so that restarting the server reuses
 * the same station instead of creating a second one.
 */
export const DEMO_STATION_ID: StationId = toStationId('demo-station');
