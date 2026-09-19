import { describe, expect, it } from 'vitest';
import {
  evaluateTankAlarms,
  materializeAlarm,
  selectNewAlarmDrafts,
  selectResolvedAlarms,
} from '../src/alarms/alarm-engine.js';
import type { Alarm, AlarmDraft, AlarmType } from '../src/domain/alarm.js';
import type { TankReading } from '../src/domain/reading.js';
import { makeReading, makeTank, TENANT_A } from './factories.js';

const NOW = new Date('2026-01-01T02:00:00.000Z');
const CAPACITY = 19_000;

function tankWith(overrides = {}) {
  return makeTank({ capacityLitres: CAPACITY, ...overrides });
}

function types(result: ReturnType<typeof evaluateTankAlarms>): AlarmType[] {
  return result.drafts.map((draft) => draft.type);
}

function readingAt(offsetMinutes: number, netVolumeLitres: number, extra = {}): TankReading {
  return makeReading({
    id: `rdg-${offsetMinutes}` as TankReading['id'],
    recordedAt: new Date(NOW.getTime() - offsetMinutes * 60_000).toISOString(),
    netVolumeLitres,
    ...extra,
  });
}

describe('alarm engine', () => {
  it('raises a warning below the low threshold and a critical below the critical threshold', () => {
    const tank = tankWith();
    expect(
      types(
        evaluateTankAlarms({ tenantId: TENANT_A, tank, readings: [readingAt(0, 2500)], now: NOW }),
      ),
    ).toContain('low-level');
    expect(
      types(
        evaluateTankAlarms({ tenantId: TENANT_A, tank, readings: [readingAt(0, 1000)], now: NOW }),
      ),
    ).toContain('critical-low-level');
  });

  it('does not raise a low level alarm for the lower severity duplicate', () => {
    const tank = tankWith();
    const drafts = evaluateTankAlarms({
      tenantId: TENANT_A,
      tank,
      readings: [readingAt(0, 500)],
      now: NOW,
    }).drafts;
    expect(drafts.filter((draft) => draft.type === 'low-level')).toHaveLength(0);
  });

  it('raises a high level alarm near capacity', () => {
    const tank = tankWith();
    expect(
      types(
        evaluateTankAlarms({
          tenantId: TENANT_A,
          tank,
          readings: [readingAt(0, 18_600)],
          now: NOW,
        }),
      ),
    ).toContain('high-level');
  });

  it('raises a rapid drop alarm when the loss rate exceeds the threshold', () => {
    const tank = tankWith();
    const readings = [readingAt(10, 10_000), readingAt(5, 9500), readingAt(0, 9000)];
    const result = evaluateTankAlarms({ tenantId: TENANT_A, tank, readings, now: NOW });
    expect(types(result)).toContain('rapid-drop');
    const draft = result.drafts.find((candidate) => candidate.type === 'rapid-drop');
    expect(draft?.severity).toBe('critical');
    expect((draft?.metrics['litresPerHour'] ?? 0) as number).toBeCloseTo(6000, 0);
  });

  it('does not raise a rapid drop alarm for ordinary dispensing', () => {
    const tank = tankWith();
    const readings = [readingAt(10, 10_000), readingAt(0, 9950)];
    expect(
      types(evaluateTankAlarms({ tenantId: TENANT_A, tank, readings, now: NOW })),
    ).not.toContain('rapid-drop');
  });

  it('detects a delivery when volume rises inside the delivery window', () => {
    const tank = tankWith();
    const readings = [readingAt(10, 10_000), readingAt(0, 10_600)];
    const result = evaluateTankAlarms({ tenantId: TENANT_A, tank, readings, now: NOW });
    expect(types(result)).toContain('delivery-detected');
    const draft = result.drafts.find((candidate) => candidate.type === 'delivery-detected');
    expect(draft?.severity).toBe('info');
  });

  it('ignores a slow rise outside the delivery window', () => {
    const tank = tankWith();
    const readings = [readingAt(120, 10_000), readingAt(0, 10_600)];
    expect(
      types(evaluateTankAlarms({ tenantId: TENANT_A, tank, readings, now: NOW })),
    ).not.toContain('delivery-detected');
  });

  it('raises a water ingress alarm above the water threshold', () => {
    const tank = tankWith();
    const readings = [readingAt(0, 10_000, { waterLevelMm: 75 })];
    expect(types(evaluateTankAlarms({ tenantId: TENANT_A, tank, readings, now: NOW }))).toContain(
      'water-ingress',
    );
  });

  it('raises a stale reading alarm when the latest observation is too old', () => {
    const tank = tankWith();
    const readings = [readingAt(180, 10_000)];
    expect(types(evaluateTankAlarms({ tenantId: TENANT_A, tank, readings, now: NOW }))).toContain(
      'stale-reading',
    );
  });

  it('raises a sensor fault after consecutive invalid readings', () => {
    const tank = tankWith();
    const readings = [
      readingAt(20, 0, { quality: 'invalid' }),
      readingAt(10, 0, { quality: 'invalid' }),
      readingAt(0, 0, { quality: 'invalid' }),
    ];
    const result = evaluateTankAlarms({ tenantId: TENANT_A, tank, readings, now: NOW });
    expect(types(result)).toContain('sensor-fault');
    expect(types(result)).toContain('stale-reading');
  });

  it('reports stale and fault alarms when no reading has ever arrived', () => {
    const tank = tankWith();
    const result = evaluateTankAlarms({ tenantId: TENANT_A, tank, readings: [], now: NOW });
    expect(types(result)).toContain('stale-reading');
    expect(result.estimatedNetVolumeLitres).toBeNull();
    expect(result.fillPercent).toBeNull();
  });

  it('returns the estimated fill percentage for reporting', () => {
    const tank = tankWith();
    const result = evaluateTankAlarms({
      tenantId: TENANT_A,
      tank,
      readings: [readingAt(0, 9500)],
      now: NOW,
    });
    expect(result.fillPercent).toBeCloseTo(50, 6);
  });
});

describe('alarm lifecycle', () => {
  const draftOf = (type: AlarmType): AlarmDraft => ({
    tankId: makeTank().id,
    type,
    severity: 'warning',
    message: 'test',
    readingId: null,
    metrics: {},
  });

  const alarmOf = (type: AlarmType): Alarm =>
    materializeAlarm(draftOf(type), TENANT_A, NOW, `alm-${type}` as Alarm['id']);

  it('suppresses drafts whose type is already open for the tank', () => {
    const drafts = [draftOf('low-level'), draftOf('high-level')];
    const remaining = selectNewAlarmDrafts(drafts, [alarmOf('low-level')]);
    expect(remaining.map((draft) => draft.type)).toEqual(['high-level']);
  });

  it('resolves open alarms whose condition has cleared', () => {
    const drafts = [draftOf('high-level')];
    const resolved = selectResolvedAlarms(drafts, [alarmOf('low-level')]);
    expect(resolved.map((alarm) => alarm.type)).toEqual(['low-level']);
  });

  it('materializes an alarm as open with the tenant of the caller', () => {
    const alarm = materializeAlarm(draftOf('low-level'), TENANT_A, NOW);
    expect(alarm.status).toBe('open');
    expect(alarm.tenantId).toBe(TENANT_A);
    expect(alarm.raisedAt).toBe('2026-01-01T02:00:00.000Z');
    expect(alarm.id).toContain('alm-');
  });
});
