import { isSimulatedScenario, type SimulatedScenario } from '@fueltrack/core';

export interface SimulatorRunnerConfig {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly tankIds: ReadonlyArray<string>;
  readonly intervalSeconds: number;
  readonly dtMinutes: number;
  readonly scenario: SimulatedScenario;
  readonly seed: string;
  /** Stops after this many cycles. Null runs until interrupted. */
  readonly maxSteps: number | null;
  readonly latencyMs: number;
  readonly failureRate: number;
}

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentError';
  }
}

export const SIMULATOR_USAGE = [
  'Usage: fueltrack-simulator --api-url <url> --api-key <key> --tank-id <id> [options]',
  '',
  'Required:',
  '  --api-url <url>        Base URL of the FuelTrack API (for example http://localhost:3000)',
  '  --api-key <key>        API key holding the simulator:write scope',
  '  --tank-id <id>         Tank to simulate (repeatable, at least one required)',
  '',
  'Options:',
  '  --interval-seconds <n> Polling interval, 1 to 3600 (default 30)',
  '  --dt-minutes <n>       Simulated minutes elapsed per poll, 0.1 to 1440 (default 1)',
  '  --scenario <name>      nominal | delivery | leak | theft | water-ingress | sensor-stuck | offline (default nominal)',
  '  --seed <value>         Deterministic seed (default fueltrack-ea)',
  '  --max-steps <n>        Stop after n cycles (default: run until interrupted)',
  '  --latency-ms <n>       Simulated probe latency (default 0)',
  '  --failure-rate <0..1>  Fraction of polls that fail transiently (default 0)',
  '',
  'All data produced by this tool is synthetic and tagged as simulated.',
].join('\n');

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ArgumentError(`Missing value for ${flag}`);
  }
  return value;
}

function readNumber(raw: string, flag: string, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ArgumentError(`${flag} must be a number between ${min} and ${max}`);
  }
  return parsed;
}

export function parseArgs(argv: ReadonlyArray<string>): SimulatorRunnerConfig {
  if (argv.includes('--help') || argv.includes('-h')) {
    throw new ArgumentError(SIMULATOR_USAGE);
  }

  let apiUrl: string | null = null;
  let apiKey: string | null = null;
  let intervalSeconds = 30;
  let dtMinutes = 1;
  let scenario: SimulatedScenario = 'nominal';
  let seed = 'fueltrack-ea';
  let maxSteps: number | null = null;
  let latencyMs = 0;
  let failureRate = 0;
  const tankIds: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case '--api-url':
        apiUrl = readValue(argv as string[], index, flag);
        index += 1;
        break;
      case '--api-key':
        apiKey = readValue(argv as string[], index, flag);
        index += 1;
        break;
      case '--tank-id':
        tankIds.push(readValue(argv as string[], index, flag));
        index += 1;
        break;
      case '--interval-seconds':
        intervalSeconds = readNumber(readValue(argv as string[], index, flag), flag, 1, 3600);
        index += 1;
        break;
      case '--dt-minutes':
        dtMinutes = readNumber(readValue(argv as string[], index, flag), flag, 0.1, 1440);
        index += 1;
        break;
      case '--scenario': {
        const raw = readValue(argv as string[], index, flag);
        if (!isSimulatedScenario(raw)) {
          throw new ArgumentError(`Unknown scenario "${raw}"`);
        }
        scenario = raw;
        index += 1;
        break;
      }
      case '--seed':
        seed = readValue(argv as string[], index, flag);
        index += 1;
        break;
      case '--max-steps':
        maxSteps = readNumber(readValue(argv as string[], index, flag), flag, 1, 100_000);
        index += 1;
        break;
      case '--latency-ms':
        latencyMs = readNumber(readValue(argv as string[], index, flag), flag, 0, 60_000);
        index += 1;
        break;
      case '--failure-rate':
        failureRate = readNumber(readValue(argv as string[], index, flag), flag, 0, 1);
        index += 1;
        break;
      default:
        throw new ArgumentError(`Unknown argument "${String(flag)}"`);
    }
  }

  if (apiUrl === null) {
    throw new ArgumentError('--api-url is required');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new ArgumentError('--api-url must be an absolute http or https URL');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ArgumentError('--api-url must use http or https');
  }

  if (apiKey === null || apiKey.trim().length === 0) {
    throw new ArgumentError('--api-key is required');
  }
  if (tankIds.length === 0) {
    throw new ArgumentError('At least one --tank-id is required');
  }
  for (const tankId of tankIds) {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(tankId)) {
      throw new ArgumentError(`Invalid --tank-id "${tankId}"`);
    }
  }

  return {
    apiUrl: parsedUrl.toString().replace(/\/$/, ''),
    apiKey,
    tankIds,
    intervalSeconds,
    dtMinutes,
    scenario,
    seed,
    maxSteps,
    latencyMs,
    failureRate,
  };
}
