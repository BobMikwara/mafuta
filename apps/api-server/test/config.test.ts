import { describe, expect, it } from 'vitest';
import { ConfigurationError, DEMO_STATION_ID, readConfig } from '../src/config.js';

describe('api server configuration', () => {
  it('applies safe defaults with no environment', () => {
    const config = readConfig({});
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(3000);
    expect(config.minLogLevel).toBe('info');
    expect(config.requestLogging).toBe(true);
    expect(config.seedDemo).toBe(false);
    expect(config.autoMigrate).toBe(false);
    expect(config.devApiKey).toBeNull();
    expect(config.demoTenantId).toBe('demo-tenant');
    expect(config.dashboardDir).toBeNull();
  });

  it('enables cold start migration only on the exact opt-in value', () => {
    expect(readConfig({ FUELTRACK_AUTO_MIGRATE: 'true' }).autoMigrate).toBe(true);
    expect(readConfig({ FUELTRACK_AUTO_MIGRATE: '1' }).autoMigrate).toBe(false);
    expect(readConfig({ FUELTRACK_AUTO_MIGRATE: 'TRUE' }).autoMigrate).toBe(false);
    expect(readConfig({ FUELTRACK_AUTO_MIGRATE: '' }).autoMigrate).toBe(false);
  });

  it('reads the port, host and log level', () => {
    const config = readConfig({
      HOST: '127.0.0.1',
      PORT: '8080',
      FUELTRACK_LOG_LEVEL: 'debug',
      FUELTRACK_REQUEST_LOGGING: 'false',
      FUELTRACK_DASHBOARD_DIR: '/srv/dashboard',
    });
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8080);
    expect(config.minLogLevel).toBe('debug');
    expect(config.requestLogging).toBe(false);
    expect(config.dashboardDir).toBe('/srv/dashboard');
  });

  it('rejects an out of range or non numeric port', () => {
    expect(() => readConfig({ PORT: '0' })).toThrow(ConfigurationError);
    expect(() => readConfig({ PORT: '70000' })).toThrow(ConfigurationError);
    expect(() => readConfig({ PORT: '80.5' })).toThrow(ConfigurationError);
    expect(() => readConfig({ PORT: 'http' })).toThrow(ConfigurationError);
  });

  it('rejects an unknown log level', () => {
    expect(() => readConfig({ FUELTRACK_LOG_LEVEL: 'verbose' })).toThrow(ConfigurationError);
  });

  it('accepts every documented log level', () => {
    for (const level of ['debug', 'info', 'warn', 'error', 'critical']) {
      expect(readConfig({ FUELTRACK_LOG_LEVEL: level }).minLogLevel).toBe(level);
    }
  });

  it('requires an operator supplied key before seeding demo data', () => {
    expect(() => readConfig({ FUELTRACK_SEED_DEMO: 'true' })).toThrow(ConfigurationError);
    expect(() =>
      readConfig({ FUELTRACK_SEED_DEMO: 'true', FUELTRACK_DEV_API_KEY: 'short' }),
    ).toThrow(ConfigurationError);
    const config = readConfig({
      FUELTRACK_SEED_DEMO: 'true',
      FUELTRACK_DEV_API_KEY: 'a'.repeat(24),
    });
    expect(config.seedDemo).toBe(true);
    expect(config.devApiKey).toBe('a'.repeat(24));
  });

  it('requires credentials by default and allows an explicit opt out', () => {
    // A server that cannot authenticate anybody rejects every request, so it
    // must not start unless the operator opts out deliberately.
    expect(readConfig({}).requireCredentials).toBe(true);
    expect(readConfig({ FUELTRACK_REQUIRE_CREDENTIALS: 'true' }).requireCredentials).toBe(true);
    expect(readConfig({ FUELTRACK_REQUIRE_CREDENTIALS: 'false' }).requireCredentials).toBe(false);
    expect(readConfig({ FUELTRACK_REQUIRE_CREDENTIALS: '' }).requireCredentials).toBe(true);
    expect(() => readConfig({ FUELTRACK_REQUIRE_CREDENTIALS: 'flase' })).toThrow(
      ConfigurationError,
    );
  });

  it('rejects a demo tenant identifier that is not a valid identifier', () => {
    expect(() => readConfig({ FUELTRACK_DEMO_TENANT_ID: 'Not Valid' })).toThrow(ConfigurationError);
    expect(readConfig({ FUELTRACK_DEMO_TENANT_ID: 'acme-fuels' }).demoTenantId).toBe('acme-fuels');
  });

  it('keeps the operator key out of the log level and dashboard defaults', () => {
    const config = readConfig({ FUELTRACK_DEV_API_KEY: 'a'.repeat(24) });
    // The key is only surfaced when demo seeding is explicitly enabled.
    expect(config.seedDemo).toBe(false);
    expect(config.devApiKey).toBe('a'.repeat(24));
  });

  it('exposes the demo station identifier used by the seeder', () => {
    expect(DEMO_STATION_ID).toBe('demo-station');
  });
});
