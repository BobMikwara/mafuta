/**
 * Behavioural profiles for the simulator. They model *fuel movement patterns*
 * so that the alarm rules, dashboards and ingest path can be exercised. They
 * are not a model of any specific probe, controller or site.
 */
export const SIMULATED_SCENARIOS = [
  'nominal',
  'delivery',
  'leak',
  'theft',
  'water-ingress',
  'sensor-stuck',
  'offline',
] as const;

export type SimulatedScenario = (typeof SIMULATED_SCENARIOS)[number];

export function isSimulatedScenario(value: string): value is SimulatedScenario {
  return (SIMULATED_SCENARIOS as ReadonlyArray<string>).includes(value);
}

export interface ScenarioEffect {
  /** Extra product removed, in litres per hour (negative values would add). */
  readonly extraDrawLitresPerHour: number;
  /** Product added, in litres per hour (a tanker delivery). */
  readonly extraFillLitresPerHour: number;
  /** Water level growth, in millimetres per hour. */
  readonly waterGrowthMmPerHour: number;
  /** When true the reported level is frozen while the scenario is active. */
  readonly freezeLevel: boolean;
  /** When true the adapter reports the device as unreachable. */
  readonly offline: boolean;
  readonly description: string;
}

const NO_EFFECT: ScenarioEffect = {
  extraDrawLitresPerHour: 0,
  extraFillLitresPerHour: 0,
  waterGrowthMmPerHour: 0,
  freezeLevel: false,
  offline: false,
  description: 'Normal dispensing activity',
};

export const SCENARIO_EFFECTS: Readonly<Record<SimulatedScenario, ScenarioEffect>> = {
  nominal: NO_EFFECT,
  delivery: {
    ...NO_EFFECT,
    extraFillLitresPerHour: 36_000,
    description: 'Tanker delivery in progress',
  },
  leak: {
    ...NO_EFFECT,
    extraDrawLitresPerHour: 45,
    description: 'Slow continuous product loss consistent with a leak',
  },
  theft: {
    ...NO_EFFECT,
    extraDrawLitresPerHour: 1_800,
    description: 'Rapid product loss consistent with theft',
  },
  'water-ingress': {
    ...NO_EFFECT,
    waterGrowthMmPerHour: 12,
    description: 'Water accumulating at the bottom of the tank',
  },
  'sensor-stuck': {
    ...NO_EFFECT,
    freezeLevel: true,
    description: 'Probe reports a constant level',
  },
  offline: {
    ...NO_EFFECT,
    offline: true,
    description: 'Probe is unreachable',
  },
};
