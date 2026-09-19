import { levelForVolumeLitres, maxLevelMm, volumeAtLevelLitres } from '../domain/geometry.js';
import type { ProbeSample } from '../domain/normalize.js';
import type { Tank } from '../domain/tank.js';
import type { Clock } from '../ports/clock.js';
import { systemClock } from '../ports/clock.js';
import type { TankId } from '../types/ids.js';
import { createRng, type Rng } from './rng.js';
import { SCENARIO_EFFECTS, type SimulatedScenario } from './scenarios.js';

/**
 * SIMULATED DATA GENERATOR.
 *
 * This class produces synthetic tank behaviour for development, testing and
 * demonstrations. It is not a model of any real probe and must never be used
 * in production. Every sample it emits is tagged `source: 'simulated'` and the
 * accompanying adapter reports `kind: 'simulated'`, so downstream consumers can
 * always tell simulated values from device measurements.
 */
export interface SimulatorConfig {
  readonly seed: number | string;
  /** Baseline product dispensed, in litres per hour. */
  readonly baselineDrawLitresPerHour: number;
  /** Symmetric spread applied to the baseline draw, 0 to 1. */
  readonly drawJitter: number;
  readonly temperatureBaseC: number;
  readonly temperatureAmplitudeC: number;
  readonly temperaturePeriodMinutes: number;
  readonly levelNoiseMm: number;
  readonly temperatureNoiseC: number;
  /** Starting level as a percentage of tank capacity. */
  readonly initialFillPercent: number;
  readonly initialWaterLevelMm: number;
  readonly deviceIdPrefix: string;
}

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  seed: 'fueltrack-ea',
  baselineDrawLitresPerHour: 260,
  drawJitter: 0.25,
  temperatureBaseC: 24,
  temperatureAmplitudeC: 3.5,
  temperaturePeriodMinutes: 1440,
  levelNoiseMm: 1.2,
  temperatureNoiseC: 0.2,
  initialFillPercent: 65,
  initialWaterLevelMm: 3,
  deviceIdPrefix: 'sim',
};

export interface SimulatorStepInput {
  readonly tank: Tank;
  readonly at?: Date;
  readonly dtMinutes?: number;
  readonly scenario?: SimulatedScenario;
}

export interface TankSimulatorState {
  readonly levelMm: number;
  readonly waterLevelMm: number;
  readonly elapsedMinutes: number;
  readonly frozenLevelMm: number | null;
}

export class TankSimulator {
  private readonly config: SimulatorConfig;
  private readonly rng: Rng;
  private readonly clock: Clock;
  private readonly states = new Map<TankId, TankSimulatorState>();

  constructor(config: Partial<SimulatorConfig> = {}, clock: Clock = systemClock) {
    this.config = { ...DEFAULT_SIMULATOR_CONFIG, ...config };
    this.rng = createRng(this.config.seed);
    this.clock = clock;
  }

  step(input: SimulatorStepInput): ProbeSample {
    const { tank } = input;
    const dtMinutes = input.dtMinutes ?? 1;
    const scenario: SimulatedScenario = input.scenario ?? 'nominal';
    const effect = SCENARIO_EFFECTS[scenario];
    const at = input.at ?? this.clock.now();

    const previous = this.ensureState(tank);
    const elapsedMinutes = previous.elapsedMinutes + dtMinutes;

    const drawLitres =
      ((this.config.baselineDrawLitresPerHour * this.rng.jitter(this.config.drawJitter) +
        effect.extraDrawLitresPerHour) *
        dtMinutes) /
      60;
    const fillLitres = (effect.extraFillLitresPerHour * dtMinutes) / 60;

    const currentVolume = volumeAtLevelLitres(tank.geometry, previous.levelMm);
    const nextVolume = clamp(
      currentVolume - drawLitres + fillLitres,
      0,
      volumeAtLevelLitres(tank.geometry, maxLevelMm(tank.geometry)),
    );
    const trueLevelMm = clamp(
      levelForVolumeLitres(tank.geometry, nextVolume) +
        this.rng.gaussian(0, this.config.levelNoiseMm),
      0,
      maxLevelMm(tank.geometry),
    );

    const waterLevelMm = clamp(
      previous.waterLevelMm + (effect.waterGrowthMmPerHour * dtMinutes) / 60,
      0,
      maxLevelMm(tank.geometry),
    );

    const frozenLevelMm = effect.freezeLevel ? (previous.frozenLevelMm ?? trueLevelMm) : null;
    const reportedLevelMm =
      effect.freezeLevel && frozenLevelMm !== null ? frozenLevelMm : trueLevelMm;

    const next: TankSimulatorState = {
      levelMm: trueLevelMm,
      waterLevelMm,
      elapsedMinutes,
      frozenLevelMm,
    };
    this.states.set(tank.id, next);

    const temperatureC =
      this.config.temperatureBaseC +
      this.config.temperatureAmplitudeC *
        Math.sin((2 * Math.PI * elapsedMinutes) / this.config.temperaturePeriodMinutes) +
      this.rng.gaussian(0, this.config.temperatureNoiseC);

    return {
      tankId: tank.id,
      observedAt: at.toISOString(),
      levelMm: round2(reportedLevelMm),
      waterLevelMm: round2(waterLevelMm),
      temperatureC: round2(temperatureC),
      deviceId: `${this.config.deviceIdPrefix}-${tank.id}`,
      source: 'simulated',
    };
  }

  stateOf(tankId: TankId): TankSimulatorState | undefined {
    return this.states.get(tankId);
  }

  reset(tankId?: TankId): void {
    if (tankId === undefined) {
      this.states.clear();
      return;
    }
    this.states.delete(tankId);
  }

  private ensureState(tank: Tank): TankSimulatorState {
    const existing = this.states.get(tank.id);
    if (existing !== undefined) {
      return existing;
    }
    const initialVolume = (tank.capacityLitres * this.config.initialFillPercent) / 100;
    const created: TankSimulatorState = {
      levelMm: levelForVolumeLitres(tank.geometry, initialVolume),
      waterLevelMm: Math.min(this.config.initialWaterLevelMm, maxLevelMm(tank.geometry)),
      elapsedMinutes: 0,
      frozenLevelMm: null,
    };
    this.states.set(tank.id, created);
    return created;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
