import { ageMinutes, DEFAULT_DELAYED_AFTER_MINUTES, withFreshness } from './freshness.js';
import { netVolumeMl, type TankReading } from './reading.js';
import type { Alert } from './alert.js';
import {
  fillPercentMl,
  freeCapacityMl,
  stockStatus,
  usableCapacityMl,
  type StockStatus,
  type Tank,
} from './tank.js';
import type { Station } from './station.js';
import type { Millilitres } from './quantity.js';

/**
 * View models shared by the HTTP layer and the reports.
 *
 * They exist so that "what the operator sees" is built in one place: freshness
 * is recomputed here, provenance is preserved, and a value that comes from a
 * calculation rather than a measurement stays distinguishable in the payload.
 */
export interface ReadingView extends TankReading {
  /** Minutes since the reading was recorded, at the moment it was read. */
  readonly ageMinutes: number | null;
  /** True when the reading is old enough to be presented as stale. */
  readonly isStale: boolean;
}

export function toReadingView(
  reading: TankReading,
  now: Date,
  staleAfterMinutes: number,
): ReadingView {
  const refreshed = withFreshness(reading, now, {
    staleAfterMinutes,
    delayedAfterMinutes: DEFAULT_DELAYED_AFTER_MINUTES,
  });
  const age = ageMinutes(refreshed, now);
  return {
    ...refreshed,
    ageMinutes: age === null ? null : Math.round(age * 10) / 10,
    isStale: refreshed.freshness === 'stale',
  };
}

export interface TankSummary {
  readonly tank: Tank;
  readonly station: Station | null;
  readonly latestReading: ReadingView | null;
  /** Null when the tank has no usable reading yet. */
  readonly netVolumeMl: Millilitres | null;
  readonly fillPercent: number | null;
  readonly freeCapacityMl: Millilitres | null;
  readonly stockStatus: StockStatus | null;
  /** True when the tank is at or above its configured high threshold. */
  readonly overfillRisk: boolean;
  readonly openAlertCount: number;
  readonly highestOpenSeverity: Alert['severity'] | null;
  /** True when there is no reading, or the latest reading is not fresh. */
  readonly dataMissingOrStale: boolean;
}

export function toTankSummary(input: {
  readonly tank: Tank;
  readonly station: Station | null;
  readonly latestReading: TankReading | null;
  readonly openAlerts: ReadonlyArray<Alert>;
  readonly now: Date;
}): TankSummary {
  const { tank, latestReading, openAlerts, now } = input;
  const staleAfter = tank.thresholds.staleAfterMinutes;
  const view = latestReading === null ? null : toReadingView(latestReading, now, staleAfter);
  // An invalid reading is excluded from stock arithmetic: reporting a fill
  // percentage derived from an impossible measurement would be worse than
  // reporting that the value is unavailable.
  const usable = view !== null && view.quality !== 'invalid' ? view : null;
  const volume = usable === null ? null : netVolumeMl(usable);
  const percent = volume === null ? null : fillPercentMl(tank, volume);

  return {
    tank,
    station: input.station,
    latestReading: view,
    netVolumeMl: volume,
    fillPercent: percent === null ? null : Math.round(percent * 10) / 10,
    freeCapacityMl: volume === null ? null : freeCapacityMl(tank, volume),
    stockStatus: volume === null ? null : stockStatus(tank, volume),
    overfillRisk: percent !== null && percent >= tank.thresholds.highPercent,
    openAlertCount: openAlerts.length,
    highestOpenSeverity: highestSeverity(openAlerts),
    dataMissingOrStale: view === null || view.freshness !== 'fresh' || view.quality === 'invalid',
  };
}

export function highestSeverity(alerts: ReadonlyArray<Alert>): Alert['severity'] | null {
  let highest: Alert['severity'] | null = null;
  for (const alert of alerts) {
    if (alert.severity === 'critical') return 'critical';
    if (alert.severity === 'warning') highest = 'warning';
    else if (highest === null) highest = 'info';
  }
  return highest;
}

/** Aggregate stock for one product across the tanks of a tenant. */
export interface ProductStock {
  readonly product: Tank['product'];
  readonly tankCount: number;
  readonly capacityMl: Millilitres;
  readonly netVolumeMl: Millilitres;
  readonly fillPercent: number;
  readonly tanksWithoutReading: number;
}

export function summariseProductStock(
  summaries: ReadonlyArray<TankSummary>,
): ReadonlyArray<ProductStock> {
  const byProduct = new Map<Tank['product'], ProductStock>();
  for (const summary of summaries) {
    const capacity = usableCapacityMl(summary.tank);
    const existing = byProduct.get(summary.tank.product) ?? {
      product: summary.tank.product,
      tankCount: 0,
      capacityMl: 0,
      netVolumeMl: 0,
      fillPercent: 0,
      tanksWithoutReading: 0,
    };
    const volume = summary.netVolumeMl;
    byProduct.set(summary.tank.product, {
      product: existing.product,
      tankCount: existing.tankCount + 1,
      capacityMl: existing.capacityMl + capacity,
      netVolumeMl: existing.netVolumeMl + (volume ?? 0),
      fillPercent: 0,
      tanksWithoutReading: existing.tanksWithoutReading + (volume === null ? 1 : 0),
    });
  }
  return [...byProduct.values()]
    .map((entry) => ({
      ...entry,
      fillPercent:
        entry.capacityMl === 0 ? 0 : Math.round((entry.netVolumeMl / entry.capacityMl) * 1000) / 10,
    }))
    .sort((left, right) => left.product.localeCompare(right.product));
}
