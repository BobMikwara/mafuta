import { describe, expect, it } from 'vitest';
import {
  devicePath,
  parsePath,
  readingsPath,
  stationPath,
  tankPath,
  tanksPath,
} from '../src/lib/router.js';

describe('parsePath', () => {
  it('maps implemented screens and ignores a trailing slash', () => {
    expect(parsePath('/').name).toBe('dashboard');
    expect(parsePath('/dashboard').nav).toBe('dashboard');
    expect(parsePath('/stations/').name).toBe('stations');
    expect(parsePath('/stations/stn-1')).toEqual(
      expect.objectContaining({ name: 'station', resourceId: 'stn-1', nav: 'stations' }),
    );
    expect(parsePath('/tanks').name).toBe('tanks');
    expect(parsePath('/tanks/tnk-1').name).toBe('tank');
    expect(parsePath('/devices').name).toBe('devices');
    expect(parsePath('/devices/dev-1').name).toBe('device');
    expect(parsePath('/readings').name).toBe('readings');
    expect(parsePath('/deliveries').name).toBe('deliveries');
    expect(parsePath('/reconciliation').name).toBe('reconciliation');
    expect(parsePath('/alerts').name).toBe('alerts');
    expect(parsePath('/reports').name).toBe('reports');
    expect(parsePath('/settings').name).toBe('settings');
  });

  it('does not treat a query-shaped path or an extra segment as a resource', () => {
    expect(parsePath('/readings/extra').name).toBe('not-found');
    expect(parsePath('/unknown').name).toBe('not-found');
    expect(parsePath('/stations/%E0%A4%A').resourceId).toBe('%E0%A4%A');
    expect(parsePath('/tanks/diesel%201').resourceId).toBe('diesel 1');
  });
});

describe('path builders', () => {
  it('keeps the readings filter on the tank query key', () => {
    expect(stationPath('stn/1')).toBe('/stations/stn%2F1');
    expect(tankPath('tnk 1')).toBe('/tanks/tnk%201');
    expect(devicePath('dev-1')).toBe('/devices/dev-1');
    expect(readingsPath()).toBe('/readings');
    expect(readingsPath('')).toBe('/readings');
    expect(readingsPath('tnk-1')).toBe('/readings?tank=tnk-1');
    expect(tanksPath()).toBe('/tanks');
    expect(tanksPath('stn-1')).toBe('/tanks?station=stn-1');
  });
});
