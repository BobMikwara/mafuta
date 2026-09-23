import { describe, expect, it } from 'vitest';
import {
  buildCreateStationBody,
  buildCreateTankBody,
  buildDipBody,
  buildRegisterDeviceBody,
  buildUpdateStationBody,
  buildUpdateTankBody,
  DEFAULT_TANK_FORM,
  emptyStationForm,
  issueMap,
  knownTimezones,
  suggestTankCapacity,
  validateDevice,
  validateDip,
  validateStation,
  validateTank,
} from '../src/lib/fleet-forms.js';

const validTank = {
  ...DEFAULT_TANK_FORM,
  stationId: 'stn-1',
  name: 'Diesel 1',
  diameterMm: '2000',
  lengthOrHeightMm: '6000',
  capacityLitres: '18000',
};

describe('station form', () => {
  it('accepts a station and uppercases nothing until the server does', () => {
    const values = {
      ...emptyStationForm(),
      name: ' Mlimani ',
      code: 'mlm-01',
      timezone: 'Africa/Dar_es_Salaam',
    };
    expect(validateStation(values)).toEqual([]);
    expect(buildCreateStationBody(values)).toEqual({
      name: 'Mlimani',
      code: 'mlm-01',
      timezone: 'Africa/Dar_es_Salaam',
    });
    expect(buildUpdateStationBody({ ...values, status: 'inactive' })).toEqual({
      name: 'Mlimani',
      timezone: 'Africa/Dar_es_Salaam',
      status: 'inactive',
    });
  });

  it('rejects an empty name, a short code, a bad timezone and a bad status', () => {
    const issues = validateStation({
      name: '',
      code: 'x',
      timezone: 'not a zone',
      status: 'closed' as 'active',
    });
    expect(issues.map((issue) => issue.path)).toEqual(['name', 'code', 'timezone', 'status']);
    expect(validateStation({ ...emptyStationForm(), name: 'x'.repeat(121) })[0]?.path).toBe('name');
    expect(issueMap(issues).get('code')).toContain('2 to 32');
    expect(knownTimezones('Pacific/Auckland')[0]?.value).toBe('Pacific/Auckland');
    expect(knownTimezones('Africa/Dar_es_Salaam').some((zone) => zone.value === 'UTC')).toBe(true);
  });
});

describe('tank form', () => {
  it('builds a create body whose capacity is inside the geometry', () => {
    expect(validateTank(validTank)).toEqual([]);
    const body = buildCreateTankBody(validTank);
    expect(body.stationId).toBe('stn-1');
    expect(body.geometry).toEqual({
      kind: 'horizontal-cylinder',
      diameterMm: 2000,
      lengthMm: 6000,
    });
    expect(body.capacityLitres).toBe(18000);
    expect(body.thresholds.criticalLowPercent).toBe(10);
    expect(suggestTankCapacity(validTank)).toBeGreaterThan(18000);
  });

  it('builds a vertical cylinder and can omit geometry on edit', () => {
    const vertical = { ...validTank, geometryKind: 'vertical-cylinder' as const };
    expect(buildCreateTankBody(vertical).geometry).toEqual({
      kind: 'vertical-cylinder',
      diameterMm: 2000,
      heightMm: 6000,
    });
    const updated = buildUpdateTankBody(
      { ...validTank, status: 'decommissioned', calibrationSource: 'cert-1' },
      { includeGeometry: false },
    );
    expect(updated.geometry).toBeUndefined();
    expect(updated.capacityLitres).toBeUndefined();
    expect(updated.status).toBe('decommissioned');
    expect(updated.calibrationSource).toBe('cert-1');
    expect(buildUpdateTankBody(validTank).geometry?.kind).toBe('horizontal-cylinder');
  });

  it('rejects a capacity above the shape, a negative threshold and a missing station', () => {
    const over = validateTank({ ...validTank, capacityLitres: '999999' });
    expect(over.some((issue) => issue.path === 'capacityLitres')).toBe(true);
    const huge = validateTank({
      ...validTank,
      diameterMm: '20000',
      lengthOrHeightMm: '20000',
      capacityLitres: '6000000',
    });
    expect(huge.some((issue) => issue.message.includes('5,000,000'))).toBe(true);
    const thresholds = validateTank({
      ...validTank,
      criticalLowPercent: '30',
      lowPercent: '20',
      highPercent: '10',
      waterAlarmMm: '-1',
    });
    expect(thresholds.length).toBeGreaterThan(0);
    expect(
      validateTank({
        ...validTank,
        stationId: '',
        product: 'water',
        geometryKind: 'cube' as 'horizontal-cylinder',
      }).length,
    ).toBeGreaterThan(2);
    expect(
      validateTank({ ...validTank, status: 'gone' as 'active', calibrationSource: 'x'.repeat(201) })
        .length,
    ).toBe(2);
    expect(suggestTankCapacity({ ...validTank, diameterMm: '' })).toBeNull();
    expect(() => buildCreateTankBody({ ...validTank, product: 'water' })).toThrow(/not valid/);
  });
});

describe('device and dip forms', () => {
  it('registers a device and omits a blank firmware version', () => {
    const values = {
      manufacturer: 'ProbeCo',
      model: 'P-1',
      serialNumber: 'SN-100',
      protocol: 'http',
      firmwareVersion: '',
    };
    expect(validateDevice(values)).toEqual([]);
    expect(buildRegisterDeviceBody(values).firmwareVersion).toBeUndefined();
    expect(buildRegisterDeviceBody({ ...values, firmwareVersion: '1.2' }).firmwareVersion).toBe(
      '1.2',
    );
    expect(
      validateDevice({
        ...values,
        manufacturer: '',
        serialNumber: 'bad serial',
        protocol: 'vendor',
        firmwareVersion: 'x'.repeat(41),
      }).map((issue) => issue.path),
    ).toEqual(['manufacturer', 'serialNumber', 'protocol', 'firmwareVersion']);
  });

  it('builds a manual dip in the station timezone and rejects water above product', () => {
    const values = {
      observedAtLocal: '2026-03-02T09:15',
      levelMm: '1200',
      waterLevelMm: '10',
      temperatureC: '28',
    };
    expect(validateDip(values)).toEqual([]);
    expect(buildDipBody(values, 'Africa/Dar_es_Salaam', 'dip-key-01')).toMatchObject({
      observedAt: '2026-03-02T06:15:00.000Z',
      levelMm: 1200,
      waterLevelMm: 10,
      temperatureC: 28,
      source: 'manual',
      idempotencyKey: 'dip-key-01',
    });
    expect(
      buildDipBody({ ...values, temperatureC: '' }, 'UTC', 'dip-key-01')?.temperatureC,
    ).toBeNull();
    expect(buildDipBody({ ...values, observedAtLocal: 'soon' }, 'UTC', 'dip-key-01')).toBeNull();
    expect(
      validateDip({ ...values, waterLevelMm: '2000', temperatureC: '400', observedAtLocal: '' })
        .length,
    ).toBe(3);
    expect(validateDip({ ...values, levelMm: '-1' })[0]?.path).toBe('levelMm');
  });
});
