import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryLogSink,
  createLogger,
  fixedClock,
  makeTankLike,
  type ProbeSample,
  type Tank,
} from './helpers.js';
import { createSimulatorRunner, type RunnerPorts, type StepOutcome } from '../src/runner.js';
import { parseArgs } from '../src/args.js';

const NOW = fixedClock('2026-01-01T00:00:00.000Z');

function config(options: { scenario?: string; failureRate?: string } = {}) {
  return parseArgs([
    '--api-url',
    'http://localhost:3000',
    '--api-key',
    'dev-key-1234567890',
    '--tank-id',
    'tank-1',
    '--seed',
    'runner-test',
    '--dt-minutes',
    '10',
    ...(options.scenario === undefined ? [] : ['--scenario', options.scenario]),
    ...(options.failureRate === undefined ? [] : ['--failure-rate', options.failureRate]),
  ]);
}

function ports(overrides: Partial<RunnerPorts> = {}): RunnerPorts & {
  posted: Array<{ tankId: string; sample: ProbeSample }>;
} {
  const sink = createMemoryLogSink();
  const posted: Array<{ tankId: string; sample: ProbeSample }> = [];
  return {
    posted,
    logger: createLogger({ sink }),
    clock: NOW,
    fetchTank: async () => makeTankLike(),
    postReading: async (tankId: string, sample: ProbeSample) => {
      posted.push({ tankId, sample });
      return 201;
    },
    ...overrides,
  };
}

describe('simulator runner', () => {
  it('submits a simulated reading for each configured tank', async () => {
    const testPorts = ports();
    const runner = createSimulatorRunner(config(), testPorts);
    const outcomes = await runner.runOnce();

    expect(outcomes).toEqual([{ tankId: 'tank-1', status: 'sent', detail: 'HTTP 201' }]);
    expect(testPorts.posted).toHaveLength(1);
    expect(testPorts.posted[0]?.sample.source).toBe('simulated');
    expect(testPorts.posted[0]?.sample.tankId).toBe('tank-1');
    expect(testPorts.posted[0]?.sample.levelMm).toBeGreaterThan(0);
    expect(testPorts.posted[0]?.sample.observedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('is deterministic for a given seed', async () => {
    const first = ports();
    const second = ports();
    await createSimulatorRunner(config(), first).runOnce();
    await createSimulatorRunner(config(), second).runOnce();
    expect(first.posted[0]?.sample.levelMm).toBe(second.posted[0]?.sample.levelMm);
  });

  it('does not submit anything when the simulated probe is offline', async () => {
    const testPorts = ports();
    const runner = createSimulatorRunner(config({ scenario: 'offline' }), testPorts);
    const outcomes: ReadonlyArray<StepOutcome> = await runner.runOnce();

    expect(outcomes[0]?.status).toBe('probe-unavailable');
    expect(testPorts.posted).toHaveLength(0);
  });

  it('reports a transient probe failure without crashing', async () => {
    const testPorts = ports();
    const runner = createSimulatorRunner(config({ failureRate: '1' }), testPorts);
    const outcomes = await runner.runOnce();
    expect(outcomes[0]?.status).toBe('probe-unavailable');
    expect(testPorts.posted).toHaveLength(0);
  });

  it('reports a rejected submission and keeps running', async () => {
    const testPorts = ports({ postReading: async () => 403 });
    const runner = createSimulatorRunner(config(), testPorts);
    const outcomes = await runner.runOnce();
    expect(outcomes[0]?.status).toBe('rejected');
    expect(outcomes[0]?.detail).toBe('HTTP 403');
  });

  it('reports a tank that cannot be loaded', async () => {
    const testPorts = ports({
      fetchTank: async () => {
        throw new Error('HTTP 404');
      },
    });
    const outcomes = await createSimulatorRunner(config(), testPorts).runOnce();
    expect(outcomes[0]?.status).toBe('rejected');
    expect(outcomes[0]?.detail).toContain('404');
    expect(testPorts.posted).toHaveLength(0);
  });

  it('reports a transport failure', async () => {
    const testPorts = ports({
      postReading: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const outcomes = await createSimulatorRunner(config(), testPorts).runOnce();
    expect(outcomes[0]?.status).toBe('rejected');
    expect(outcomes[0]?.detail).toContain('ECONNREFUSED');
  });

  it('runs on the injected schedule until stopped', async () => {
    const testPorts = ports();
    const scheduled: { callback: (() => void) | null } = { callback: null };
    const cancel = vi.fn();
    const runner = createSimulatorRunner(config(), {
      ...testPorts,
      schedule: (fn: () => void) => {
        scheduled.callback = fn;
        return cancel;
      },
    });

    runner.start();
    await vi.waitFor(() => expect(testPorts.posted.length).toBe(1));

    scheduled.callback?.();
    await vi.waitFor(() => expect(testPorts.posted.length).toBe(2));

    runner.stop();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('simulates several tanks independently', async () => {
    const sink = createMemoryLogSink();
    const postedTanks: string[] = [];
    const parsed = parseArgs([
      '--api-url',
      'http://localhost:3000',
      '--api-key',
      'dev-key-1234567890',
      '--tank-id',
      'tank-1',
      '--tank-id',
      'tank-2',
      '--seed',
      'multi',
    ]);
    const runner = createSimulatorRunner(parsed, {
      logger: createLogger({ sink }),
      clock: NOW,
      fetchTank: async (tankId: string): Promise<Tank> => makeTankLike(tankId),
      postReading: async (tankId: string) => {
        postedTanks.push(tankId);
        return 201;
      },
    });
    const outcomes = await runner.runOnce();
    expect(postedTanks).toEqual(['tank-1', 'tank-2']);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['sent', 'sent']);
  });
});
