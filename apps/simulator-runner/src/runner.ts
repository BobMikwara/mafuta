import {
  SimulatedTankGaugeAdapter,
  TankSimulator,
  systemClock,
  type Clock,
  type Logger,
  type ProbeSample,
  type Tank,
} from '@fueltrack/core';
import type { SimulatorRunnerConfig } from './args.js';

export type StepStatus = 'sent' | 'probe-unavailable' | 'rejected';

export interface StepOutcome {
  readonly tankId: string;
  readonly status: StepStatus;
  readonly detail: string;
}

export interface RunnerPorts {
  /** Loads the current tank definition so volumes are computed from real geometry. */
  fetchTank(tankId: string): Promise<Tank>;
  /** Submits a reading. Resolves with the HTTP status code returned by the API. */
  postReading(tankId: string, sample: ProbeSample): Promise<number>;
  readonly logger: Logger;
  readonly clock?: Clock;
  /** Injectable so tests never wait on real timers. */
  readonly schedule?: (callback: () => void, intervalSeconds: number) => () => void;
}

export interface SimulatorRunner {
  runOnce(): Promise<ReadonlyArray<StepOutcome>>;
  start(): void;
  stop(): void;
}

/**
 * Drives the SIMULATED tank gauge adapter and pushes the result through the
 * public ingest endpoint. Nothing here touches hardware and nothing bypasses
 * authentication, authorization or validation: the simulator is an ordinary
 * API client holding a credential with the simulator scope.
 */
export function createSimulatorRunner(
  config: SimulatorRunnerConfig,
  ports: RunnerPorts,
): SimulatorRunner {
  const clock = ports.clock ?? systemClock;
  const simulator = new TankSimulator({ seed: config.seed }, clock);
  const adapter = new SimulatedTankGaugeAdapter({
    simulator,
    clock,
    latencyMs: config.latencyMs,
    failureRate: config.failureRate,
    scenario: config.scenario,
  });

  async function runOnce(): Promise<ReadonlyArray<StepOutcome>> {
    const outcomes: StepOutcome[] = [];

    for (const tankId of config.tankIds) {
      let tank: Tank;
      try {
        tank = await ports.fetchTank(tankId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        ports.logger.warn('simulator.tank.fetch_failed', { tankId, detail });
        outcomes.push({ tankId, status: 'rejected', detail });
        continue;
      }

      const result = await adapter.readTank({
        tank,
        at: clock.now(),
        scenario: config.scenario,
        dtMinutes: config.dtMinutes,
      });

      if (!result.ok) {
        ports.logger.warn('simulator.probe.unavailable', {
          tankId,
          code: result.error.code,
          detail: result.error.message,
        });
        outcomes.push({ tankId, status: 'probe-unavailable', detail: result.error.message });
        continue;
      }

      try {
        const statusCode = await ports.postReading(tankId, result.value);
        if (statusCode >= 200 && statusCode < 300) {
          outcomes.push({ tankId, status: 'sent', detail: `HTTP ${statusCode}` });
          ports.logger.info('simulator.reading.sent', {
            tankId,
            levelMm: result.value.levelMm,
            source: result.value.source,
            scenario: config.scenario,
          });
        } else {
          outcomes.push({ tankId, status: 'rejected', detail: `HTTP ${statusCode}` });
          ports.logger.warn('simulator.reading.rejected', { tankId, statusCode });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        outcomes.push({ tankId, status: 'rejected', detail });
        ports.logger.warn('simulator.reading.transport_failed', { tankId, detail });
      }
    }

    return outcomes;
  }

  let cancel: (() => void) | null = null;

  return {
    runOnce,
    start: () => {
      if (cancel !== null) {
        return;
      }
      const schedule =
        ports.schedule ??
        ((callback: () => void, intervalSeconds: number) => {
          const handle = setInterval(() => callback(), intervalSeconds * 1000);
          return () => clearInterval(handle);
        });

      const tick = (): void => {
        void runOnce();
      };

      // Run immediately, then on the interval, until stop() is called.
      tick();
      cancel = schedule(tick, config.intervalSeconds);
    },
    stop: () => {
      if (cancel === null) {
        return;
      }
      cancel();
      cancel = null;
      ports.logger.info('simulator.stopped', { scenario: config.scenario });
    },
  };
}
