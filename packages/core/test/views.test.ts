import { describe, expect, it } from 'vitest';
import {
  highestSeverity,
  summariseProductStock,
  toReadingView,
  toTankSummary,
  type TankSummary,
} from '../src/domain/views.js';
import { makeAlert, makeReading, makeTank, makeThresholds, tankId } from './factories.js';

/**
 * View models decide what an operator is allowed to believe: readings with no
 * parseable age, invalid measurements that must not feed stock arithmetic,
 * severity roll-ups, and product totals that count tanks without data instead
 * of silently dropping them.
 */

const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('toReadingView', () => {
  it('rounds age to one decimal and flags staleness', () => {
    const view = toReadingView(
      makeReading({
        recordedAt: '2026-06-01T11:45:00.000Z',
        receivedAt: '2026-06-01T11:45:30.000Z',
      }),
      NOW,
      60,
    );
    expect(view.ageMinutes).toBe(15);
    expect(view.isStale).toBe(false);
  });

  it('reports a null age when the recording time cannot be parsed', () => {
    const view = toReadingView(
      makeReading({ recordedAt: 'not-a-date', receivedAt: '2026-06-01T11:59:00.000Z' }),
      NOW,
      60,
    );
    expect(view.ageMinutes).toBeNull();
    expect(view.isStale).toBe(true);
  });
});

describe('toTankSummary', () => {
  const tank = makeTank({
    thresholds: makeThresholds({ highPercent: 60, staleAfterMinutes: 60 }),
  });

  it('reports missing data when the tank has no reading', () => {
    const summary = toTankSummary({
      tank,
      station: null,
      latestReading: null,
      openAlerts: [],
      now: NOW,
    });
    expect(summary.latestReading).toBeNull();
    expect(summary.netVolumeMl).toBeNull();
    expect(summary.fillPercent).toBeNull();
    expect(summary.overfillRisk).toBe(false);
    expect(summary.dataMissingOrStale).toBe(true);
  });

  it('excludes invalid readings from stock arithmetic', () => {
    const summary = toTankSummary({
      tank,
      station: null,
      latestReading: makeReading({
        quality: 'invalid',
        recordedAt: '2026-06-01T11:59:00.000Z',
        receivedAt: '2026-06-01T11:59:30.000Z',
      }),
      openAlerts: [],
      now: NOW,
    });
    expect(summary.latestReading).not.toBeNull();
    expect(summary.netVolumeMl).toBeNull();
    expect(summary.overfillRisk).toBe(false);
    expect(summary.dataMissingOrStale).toBe(true);
  });

  it('computes stock, overfill risk and alert roll-ups from a fresh reading', () => {
    const summary = toTankSummary({
      tank,
      station: null,
      latestReading: makeReading({
        quality: 'ok',
        freshness: 'fresh',
        netVolumeLitres: 15_000,
        recordedAt: '2026-06-01T11:59:00.000Z',
        receivedAt: '2026-06-01T11:59:30.000Z',
      }),
      openAlerts: [makeAlert({ severity: 'info' }), makeAlert({ severity: 'warning' })],
      now: NOW,
    });
    expect(summary.netVolumeMl).toBe(15_000_000);
    expect(summary.fillPercent).toBeGreaterThan(0);
    expect(summary.overfillRisk).toBe(true);
    expect(summary.openAlertCount).toBe(2);
    expect(summary.highestOpenSeverity).toBe('warning');
    expect(summary.dataMissingOrStale).toBe(false);
  });
});

describe('highestSeverity', () => {
  it('ranks info below warning below critical', () => {
    expect(highestSeverity([])).toBeNull();
    expect(highestSeverity([makeAlert({ severity: 'info' })])).toBe('info');
    expect(
      highestSeverity([makeAlert({ severity: 'warning' }), makeAlert({ severity: 'info' })]),
    ).toBe('warning');
    expect(
      highestSeverity([makeAlert({ severity: 'info' }), makeAlert({ severity: 'warning' })]),
    ).toBe('warning');
    expect(
      highestSeverity([makeAlert({ severity: 'info' }), makeAlert({ severity: 'info' })]),
    ).toBe('info');
    expect(
      highestSeverity([makeAlert({ severity: 'info' }), makeAlert({ severity: 'critical' })]),
    ).toBe('critical');
  });
});

describe('summariseProductStock', () => {
  function summary(overrides: Partial<TankSummary> & { tank: TankSummary['tank'] }): TankSummary {
    return {
      station: null,
      latestReading: null,
      netVolumeMl: null,
      fillPercent: null,
      freeCapacityMl: null,
      stockStatus: null,
      overfillRisk: false,
      openAlertCount: 0,
      highestOpenSeverity: null,
      dataMissingOrStale: true,
      ...overrides,
    };
  }

  it('totals one product across tanks and counts tanks without readings', () => {
    const stock = summariseProductStock([
      summary({
        tank: makeTank({ product: 'diesel' }),
        netVolumeMl: 5_000_000,
        dataMissingOrStale: false,
      }),
      summary({
        tank: makeTank({ id: tankId('tank-2'), product: 'diesel' }),
        netVolumeMl: null,
      }),
    ]);
    expect(stock).toHaveLength(1);
    expect(stock[0]?.tankCount).toBe(2);
    expect(stock[0]?.netVolumeMl).toBe(5_000_000);
    expect(stock[0]?.tanksWithoutReading).toBe(1);
    expect(stock[0]?.capacityMl).toBeGreaterThan(0);
    expect(stock[0]?.fillPercent).toBeGreaterThan(0);
  });

  it('keeps products separate and sorts them by name', () => {
    const stock = summariseProductStock([
      summary({ tank: makeTank({ product: 'petrol-95' }), netVolumeMl: 1_000 }),
      summary({ tank: makeTank({ id: tankId('tank-2'), product: 'diesel' }), netVolumeMl: 2_000 }),
      summary({ tank: makeTank({ id: tankId('tank-3'), product: 'diesel' }), netVolumeMl: null }),
    ]);
    expect(stock.map((entry) => entry.product)).toEqual(['diesel', 'petrol-95']);
    expect(stock[0]?.tanksWithoutReading).toBe(1);
  });
});
