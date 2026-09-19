import type { ProbeSample } from '../domain/normalize.js';
import type { Clock } from '../ports/clock.js';
import { systemClock } from '../ports/clock.js';
import type {
  AdapterCapabilities,
  AdapterError,
  AdapterHealth,
  ReadTankRequest,
  TankGaugeAdapter,
} from '../ports/tank-gauge-adapter.js';
import type { Result } from '../types/result.js';
import { err, ok } from '../types/result.js';
import { SCENARIO_EFFECTS, type SimulatedScenario } from './scenarios.js';
import { TankSimulator, type SimulatorConfig } from './tank-simulator.js';

export interface SimulatedAdapterOptions {
  readonly simulator?: TankSimulator;
  readonly simulatorConfig?: Partial<SimulatorConfig>;
  readonly clock?: Clock;
  /** Default scenario applied when a request does not specify one. */
  readonly scenario?: SimulatedScenario;
  /** Simulated round trip latency in milliseconds. */
  readonly latencyMs?: number;
  /** Probability in [0, 1] that a poll fails with a transient error. */
  readonly failureRate?: number;
  /** Injectable sleep so tests never wait on real time. */
  readonly delay?: (milliseconds: number) => Promise<void>;
}

const CAPABILITIES: AdapterCapabilities = {
  supportsTemperature: true,
  supportsWaterLevel: true,
  supportsDensity: false,
  minPollingIntervalSeconds: 5,
  simulated: true,
};

/**
 * Poll request accepted by the simulated adapter. The extra fields are
 * simulation controls, not part of the hardware contract, and are ignored by
 * real adapters.
 */
export interface SimulatedReadTankRequest extends ReadTankRequest {
  readonly scenario?: SimulatedScenario;
  readonly dtMinutes?: number;
}

/**
 * SIMULATED HARDWARE ADAPTER.
 *
 * Implements the same contract a real tank gauge adapter must implement, but
 * every value it returns is synthetic. It exists so the ingest pipeline, alarm
 * rules and dashboards can be built and tested before probe documentation is
 * available. Replace it with a vendor adapter implementing `TankGaugeAdapter`
 * once the exact gauge model and protocol specification are supplied.
 */
export class SimulatedTankGaugeAdapter implements TankGaugeAdapter {
  readonly vendor = 'fueltrack';
  readonly model = 'simulated-tank-gauge';
  readonly kind = 'simulated' as const;
  readonly capabilities: AdapterCapabilities = CAPABILITIES;

  private readonly simulator: TankSimulator;
  private readonly clock: Clock;
  private readonly defaultScenario: SimulatedScenario;
  private readonly latencyMs: number;
  private readonly failureRate: number;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private pollCount = 0;

  constructor(options: SimulatedAdapterOptions = {}) {
    this.simulator = options.simulator ?? new TankSimulator(options.simulatorConfig, options.clock);
    this.clock = options.clock ?? systemClock;
    this.defaultScenario = options.scenario ?? 'nominal';
    this.latencyMs = options.latencyMs ?? 0;
    this.failureRate = clamp01(options.failureRate ?? 0);
    this.delay = options.delay ?? (async () => undefined);
  }

  async readTank(request: SimulatedReadTankRequest): Promise<Result<ProbeSample, AdapterError>> {
    const scenario = request.scenario ?? this.defaultScenario;
    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }

    this.pollCount += 1;
    if (this.failureRate > 0 && this.shouldFail(this.pollCount)) {
      return err({
        code: 'timeout',
        message: 'Simulated probe did not answer within the timeout window',
        retryable: true,
      });
    }

    if (SCENARIO_EFFECTS[scenario].offline) {
      return err({
        code: 'unavailable',
        message: 'Simulated probe is offline',
        retryable: true,
      });
    }

    const sample = this.simulator.step({
      tank: request.tank,
      at: request.at ?? this.clock.now(),
      scenario,
      ...(request.dtMinutes === undefined ? {} : { dtMinutes: request.dtMinutes }),
    });

    return ok(sample);
  }

  async healthCheck(): Promise<Result<AdapterHealth, AdapterError>> {
    return ok({
      healthy: true,
      detail: 'Simulated adapter, no hardware is contacted',
      checkedAt: this.clock.now().toISOString(),
    });
  }

  /**
   * Deterministic failure schedule: one failure every `1 / failureRate` polls.
   * Deterministic behaviour keeps integration tests stable.
   */
  private shouldFail(pollCount: number): boolean {
    if (this.failureRate >= 1) {
      return true;
    }
    const every = Math.round(1 / this.failureRate);
    return every > 0 && pollCount % every === 0;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
