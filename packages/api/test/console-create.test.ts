import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCreateStationBody,
  buildCreateTankBody,
  buildUpdateStationBody,
  buildUpdateTankBody,
  DEFAULT_TANK_FORM,
  emptyStationForm,
  validateStation,
  validateTank,
} from '../../../apps/web/src/lib/fleet-forms.js';
import { bearer, createHarness, type TestHarness } from './helpers.js';

/**
 * The console used to be read-only, so "add station" and "add tank" had no
 * request to succeed. This posts the same bodies the drawers build, through
 * the same routes, and then reads them back. A save that only updates local
 * state cannot pass.
 */

let harness: TestHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.close();
});

const stationValues = {
  ...emptyStationForm(),
  name: 'Mlimani Service Station',
  code: 'mlm-01',
  timezone: 'Africa/Dar_es_Salaam',
};

const tankValues = {
  ...DEFAULT_TANK_FORM,
  stationId: 'filled-after-create',
  name: 'Diesel 1',
  product: 'diesel',
  geometryKind: 'horizontal-cylinder' as const,
  diameterMm: '2000',
  lengthOrHeightMm: '6000',
  capacityLitres: '18000',
  calibrationSource: 'strap-2026',
};

describe('console station and tank create', () => {
  it('creates a station, then a tank on that station, and reads both back', async () => {
    expect(validateStation(stationValues)).toEqual([]);
    const stationBody = buildCreateStationBody(stationValues);
    const createdStation = await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: stationBody,
    });
    expect(createdStation.statusCode).toBe(201);
    const station = createdStation.json().station as {
      id: string;
      tenantId: string;
      name: string;
      code: string;
      timezone: string;
    };
    expect(station).toMatchObject({
      name: 'Mlimani Service Station',
      code: 'MLM-01',
      timezone: 'Africa/Dar_es_Salaam',
    });

    const tankForm = { ...tankValues, stationId: station.id };
    expect(validateTank(tankForm)).toEqual([]);
    const createdTank = await harness.app.inject({
      method: 'POST',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
      payload: buildCreateTankBody(tankForm),
    });
    expect(createdTank.statusCode).toBe(201);
    const tank = createdTank.json().tank as {
      id: string;
      stationId: string;
      tenantId: string;
      capacityLitres: number;
      geometry: { kind: string };
    };
    expect(tank.stationId).toBe(station.id);
    expect(tank.tenantId).toBe(station.tenantId);
    expect(tank.capacityLitres).toBe(18000);
    expect(tank.geometry.kind).toBe('horizontal-cylinder');

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/v1/stations?limit=50',
      headers: bearer(harness.keyForTenantA),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().stations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: station.id, code: 'MLM-01' })]),
    );

    const detail = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tank.id}`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().tank.id).toBe(tank.id);
    expect(detail.json().station.id).toBe(station.id);
    expect(detail.json().netVolumeMl).toBeNull();

    const hidden = await harness.app.inject({
      method: 'GET',
      url: `/v1/stations/${station.id}`,
      headers: bearer(harness.keyForTenantB),
    });
    expect(hidden.statusCode).toBe(404);
  });

  it('updates the records the edit drawers send, and rejects a duplicate code', async () => {
    const createdStation = await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: buildCreateStationBody(stationValues),
    });
    const stationId = createdStation.json().station.id as string;
    const createdTank = await harness.app.inject({
      method: 'POST',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
      payload: buildCreateTankBody({ ...tankValues, stationId }),
    });
    const tankId = createdTank.json().tank.id as string;

    const stationPatch = await harness.app.inject({
      method: 'PATCH',
      url: `/v1/stations/${stationId}`,
      headers: bearer(harness.keyForTenantA),
      payload: buildUpdateStationBody({
        ...stationValues,
        name: 'Mlimani North',
        status: 'inactive',
      }),
    });
    expect(stationPatch.statusCode).toBe(200);
    expect(stationPatch.json().station).toMatchObject({
      name: 'Mlimani North',
      status: 'inactive',
    });

    const tankPatch = await harness.app.inject({
      method: 'PATCH',
      url: `/v1/tanks/${tankId}`,
      headers: bearer(harness.keyForTenantA),
      payload: buildUpdateTankBody(
        { ...tankValues, stationId, name: 'Diesel North', status: 'active' },
        { includeGeometry: true },
      ),
    });
    expect(tankPatch.statusCode).toBe(200);
    expect(tankPatch.json().tank.name).toBe('Diesel North');

    const duplicate = await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: buildCreateStationBody({ ...stationValues, name: 'Another' }),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('conflict');
  });

  it('rejects a tank whose capacity exceeds the declared geometry', async () => {
    const createdStation = await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: buildCreateStationBody({ ...stationValues, code: 'mlm-02' }),
    });
    const stationId = createdStation.json().station.id as string;
    const tooBig = {
      ...buildCreateTankBody({ ...tankValues, stationId }),
      capacityLitres: 5_000_000,
    };
    const rejected = await harness.app.inject({
      method: 'POST',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
      payload: tooBig,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe('validation_failed');
    expect(JSON.stringify(rejected.json().issues)).toContain('capacityLitres');
  });
});
