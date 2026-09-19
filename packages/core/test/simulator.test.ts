import { describe, expect, it } from 'vitest';
import { TankSimulator, DEFAULT_SIMULATOR_CONFIG } from '../src/simulator/tank-simulator.js';
import { SCENARIO_EFFECTS } from '../src/simulator/scenarios.js';
import { SimulatedTankGaugeAdapter } from '../src/simulator/simulated-tank-gauge-adapter.js';
import type { TankGaugeAdapter } from '../src/ports/tank-gauge-adapter.js';
import { volumeAtLevelLitres } from '../src/domain/geometry.js';
import { fixedClock } from '../src/ports/clock.js';
import { createRng } from '../src/simulator/rng.js';
import { makeTank } from './factories.js';

const TANK = makeTank();
const AT = fixedClock('2026-01-01T00:00:00.000Z');

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-1');
    const c = createRng('seed-2');
    const sequenceA = Array.from({ length: 8 }, () => a.next());
    const sequenceB = Array.from({ length: 8 }, () => b.next());
    const sequenceC = Array.from({ length: 8 }, () => c.next());
    expect(sequenceA).toEqual(sequenceB);
    expect(sequenceA).not.toEqual(sequenceC);
  });

  it('stays inside the requested bounds', () => {
    const rng = createRng(42);
    for (let index = 0; index < 500; index += 1) {
      const value = rng.float(-5, 5);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(5);
      const integer = rng.int(0, 10);
      expect(Number.isInteger(integer)).toBe(true);
      expect(integer).toBeGreaterThanOrEqual(0);
      expect(integer).toBeLessThan(10);
      const jittered = rng.jitter(0.2);
      expect(jittered).toBeGreaterThanOrEqual(0.8);
      expect(jittered).toBeLessThanOrEqual(1.2);
    }
  });
});

describe('tank simulator', () => {
  it('produces identical sequences for identical seeds', () => {
    const first = new TankSimulator({ seed: 'determinism' }, AT);
    const second = new TankSimulator({ seed: 'determinism' }, AT);
    const third = new TankSimulator({ seed: 'different' }, AT);

    const run = (simulator: TankSimulator): unknown[] =>
      Array.from({ length: 10 }, () => simulator.step({ tank: TANK, dtMinutes: 5 }));

    expect(run(first)).toEqual(run(second));
    expect(run(first)).not.toEqual(run(third));
  });

  it('tags every sample as simulated and pins the source to the adapter contract', () => {
    const simulator = new TankSimulator({ seed: 'source' }, AT);
    const sample = simulator.step({ tank: TANK, dtMinutes: 1 });
    expect(sample.source).toBe('simulated');
    expect(sample.deviceId).toContain('sim-');
    expect(sample.observedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('starts at the configured fill percentage', () => {
    const simulator = new TankSimulator(
      { seed: 'fill', initialFillPercent: 50, levelNoiseMm: 0 },
      AT,
    );
    const sample = simulator.step({ tank: TANK, dtMinutes: 0 });
    const volume = volumeAtLevelLitres(TANK.geometry, sample.levelMm);
    expect(volume / TANK.capacityLitres).toBeCloseTo(0.5, 2);
  });

  it('draws product down under the nominal scenario', () => {
    const simulator = new TankSimulator({ seed: 'draw', levelNoiseMm: 0 }, AT);
    const first = simulator.step({ tank: TANK, dtMinutes: 60 });
    let previous = volumeAtLevelLitres(TANK.geometry, first.levelMm);
    for (let index = 0; index < 5; index += 1) {
      const sample = simulator.step({ tank: TANK, dtMinutes: 60 });
      const volume = volumeAtLevelLitres(TANK.geometry, sample.levelMm);
      expect(volume).toBeLessThan(previous);
      previous = volume;
    }
  });

  it('adds product under the delivery scenario', () => {
    const simulator = new TankSimulator({ seed: 'delivery', levelNoiseMm: 0 }, AT);
    const first = simulator.step({ tank: TANK, dtMinutes: 1 });
    const second = simulator.step({ tank: TANK, dtMinutes: 1, scenario: 'delivery' });
    expect(second.levelMm).toBeGreaterThan(first.levelMm);
  });

  it('removes product faster under theft than under nominal', () => {
    const nominal = new TankSimulator({ seed: 'theft-a', levelNoiseMm: 0 }, AT);
    const theft = new TankSimulator({ seed: 'theft-b', levelNoiseMm: 0 }, AT);
    nominal.step({ tank: TANK, dtMinutes: 60 });
    theft.step({ tank: TANK, dtMinutes: 60 });

    const nominalSample = nominal.step({ tank: TANK, dtMinutes: 60, scenario: 'nominal' });
    const theftSample = theft.step({ tank: TANK, dtMinutes: 60, scenario: 'theft' });
    expect(theftSample.levelMm).toBeLessThan(nominalSample.levelMm);
  });

  it('grows the water level under the water ingress scenario', () => {
    const simulator = new TankSimulator({ seed: 'water' }, AT);
    simulator.step({ tank: TANK, dtMinutes: 60 });
    const before = simulator.step({ tank: TANK, dtMinutes: 60 }).waterLevelMm;
    const after = simulator.step({
      tank: TANK,
      dtMinutes: 60,
      scenario: 'water-ingress',
    }).waterLevelMm;
    expect(after).toBeGreaterThan(before);
  });

  it('freezes the reported level while the sensor is stuck and resumes afterwards', () => {
    const simulator = new TankSimulator({ seed: 'stuck', levelNoiseMm: 0 }, AT);
    simulator.step({ tank: TANK, dtMinutes: 60 });
    const stuck1 = simulator.step({ tank: TANK, dtMinutes: 60, scenario: 'sensor-stuck' });
    const stuck2 = simulator.step({ tank: TANK, dtMinutes: 60, scenario: 'sensor-stuck' });
    expect(stuck2.levelMm).toBe(stuck1.levelMm);

    const resumed = simulator.step({ tank: TANK, dtMinutes: 60, scenario: 'nominal' });
    expect(resumed.levelMm).toBeLessThan(stuck2.levelMm);
  });

  it('never leaves the physical bounds of the tank', () => {
    const simulator = new TankSimulator({ seed: 'bounds' }, AT);
    for (let index = 0; index < 200; index += 1) {
      const sample = simulator.step({
        tank: TANK,
        dtMinutes: 30,
        scenario: index % 2 === 0 ? 'delivery' : 'theft',
      });
      expect(sample.levelMm).toBeGreaterThanOrEqual(0);
      expect(sample.levelMm).toBeLessThanOrEqual(4000);
      expect(sample.temperatureC).not.toBeNull();
    }
  });

  it('exposes and clears per tank state', () => {
    const simulator = new TankSimulator({ seed: 'state' }, AT);
    expect(simulator.stateOf(TANK.id)).toBeUndefined();
    simulator.step({ tank: TANK, dtMinutes: 5 });
    expect(simulator.stateOf(TANK.id)).toBeDefined();
    simulator.reset(TANK.id);
    expect(simulator.stateOf(TANK.id)).toBeUndefined();
  });

  it('ships default configuration values', () => {
    expect(DEFAULT_SIMULATOR_CONFIG.initialFillPercent).toBeGreaterThan(0);
    expect(DEFAULT_SIMULATOR_CONFIG.baselineDrawLitresPerHour).toBeGreaterThan(0);
  });

  it('documents an effect for each scenario', () => {
    for (const effect of Object.values(SCENARIO_EFFECTS)) {
      expect(effect.description.length).toBeGreaterThan(0);
    }
  });
});

describe('simulated tank gauge adapter', () => {
  it('satisfies the hardware adapter contract and declares itself simulated', async () => {
    const adapter: TankGaugeAdapter = new SimulatedTankGaugeAdapter({ clock: AT });
    expect(adapter.kind).toBe('simulated');
    expect(adapter.capabilities.simulated).toBe(true);
    expect(adapter.capabilities.supportsTemperature).toBe(true);
    expect(adapter.capabilities.supportsWaterLevel).toBe(true);

    const result = await adapter.readTank({ tank: TANK });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tankId).toBe(TANK.id);
      expect(result.value.source).toBe('simulated');
    }
  });

  it('reports the probe as unreachable under the offline scenario', async () => {
    const adapter = new SimulatedTankGaugeAdapter({ clock: AT });
    const result = await adapter.readTank({ tank: TANK, scenario: 'offline' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unavailable');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('applies deterministic transient failures at the configured rate', async () => {
    const adapter = new SimulatedTankGaugeAdapter({ clock: AT, failureRate: 0.5 });
    const first = await adapter.readTank({ tank: TANK });
    const second = await adapter.readTank({ tank: TANK });
    const third = await adapter.readTank({ tank: TANK });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(third.ok).toBe(true);
  });

  it('awaits the injected latency before answering', async () => {
    const delays: number[] = [];
    const adapter = new SimulatedTankGaugeAdapter({
      clock: AT,
      latencyMs: 25,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    await adapter.readTank({ tank: TANK });
    expect(delays).toEqual([25]);
  });

  it('reports health without contacting any hardware', async () => {
    const adapter = new SimulatedTankGaugeAdapter({ clock: AT });
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
    if (health.ok) {
      expect(health.value.healthy).toBe(true);
      expect(health.value.detail).toContain('Simulated');
    }
  });
});
