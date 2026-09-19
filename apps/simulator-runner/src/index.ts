import { parseInput, tankResponseSchema, type ProbeSample, type Tank } from '@fueltrack/core';
import { createSimulatorRunner } from './runner.js';
import { ArgumentError, parseArgs, SIMULATOR_USAGE, type SimulatorRunnerConfig } from './args.js';

const SIMULATION_NOTICE = [
  'SIMULATED DATA GENERATOR',
  'This process produces synthetic tank readings. No hardware is contacted and',
  'every reading is tagged as simulated. Do not run it against production.',
].join('\n');

export function createHttpClient(config: SimulatorRunnerConfig) {
  const headers = {
    authorization: `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  return {
    async fetchTank(tankId: string): Promise<Tank> {
      const response = await fetch(`${config.apiUrl}/v1/tanks/${encodeURIComponent(tankId)}`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        throw new Error(`GET /v1/tanks/${tankId} failed with HTTP ${response.status}`);
      }
      return parseInput(tankResponseSchema, await response.json()).tank;
    },

    async postReading(tankId: string, sample: ProbeSample): Promise<number> {
      const body = {
        observedAt: sample.observedAt,
        levelMm: sample.levelMm,
        waterLevelMm: sample.waterLevelMm,
        temperatureC: sample.temperatureC,
        deviceId: sample.deviceId,
        source: sample.source,
      };
      const response = await fetch(
        `${config.apiUrl}/v1/tanks/${encodeURIComponent(tankId)}/readings`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        },
      );
      if (response.status >= 400) {
        const text = await response.text().catch(() => '');
        throw new Error(`POST readings failed with HTTP ${response.status} ${text.slice(0, 200)}`);
      }
      return response.status;
    },
  };
}

export async function main(argv: ReadonlyArray<string> = process.argv.slice(2)): Promise<void> {
  process.stdout.write(`${SIMULATION_NOTICE}\n`);

  const { createLogger, createStdioSink } = await import('@fueltrack/core');
  const logger = createLogger({
    sink: createStdioSink(),
    bindings: { component: 'simulator-runner', simulated: true },
  });

  let config: SimulatorRunnerConfig;
  try {
    config = parseArgs(argv);
  } catch (error) {
    if (error instanceof ArgumentError) {
      process.stdout.write(`${error.message}\n`);
      return;
    }
    throw error;
  }

  const client = createHttpClient(config);
  const runner = createSimulatorRunner(config, { ...client, logger });

  logger.info('simulator.starting', {
    apiUrl: config.apiUrl,
    tankIds: [...config.tankIds],
    scenario: config.scenario,
    intervalSeconds: config.intervalSeconds,
    dtMinutes: config.dtMinutes,
    seed: config.seed,
    maxSteps: config.maxSteps,
    simulated: true,
  });

  process.on('SIGINT', () => {
    runner.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    runner.stop();
    process.exit(0);
  });

  if (config.maxSteps === null) {
    runner.start();
    return;
  }

  for (let step = 0; step < config.maxSteps; step += 1) {
    await runner.runOnce();
  }
  logger.info('simulator.completed', { steps: config.maxSteps, simulated: true });
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `fueltrack-simulator failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exit(1);
  });
}

export { SIMULATOR_USAGE };
