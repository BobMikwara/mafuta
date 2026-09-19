/**
 * Deterministic pseudo random generator (mulberry32). Simulation runs must be
 * reproducible from a seed so that tests and demos are stable.
 */
export interface Rng {
  /** Uniform value in [0, 1). */
  next(): number;
  /** Uniform value in [min, max). */
  float(min: number, max: number): number;
  /** Integer in [min, max). */
  int(min: number, max: number): number;
  /** Normal value with the given mean and standard deviation. */
  gaussian(mean: number, standardDeviation: number): number;
  /** Symmetric multiplier around 1, for example 0.85 to 1.15 at spread 0.15. */
  jitter(spread: number): number;
}

function hashSeed(seed: number | string): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed: number | string): Rng {
  let state = hashSeed(seed) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const gaussian = (mean: number, standardDeviation: number): number => {
    // Box-Muller transform, clamped to avoid pathological tails.
    const u = Math.max(next(), Number.EPSILON);
    const v = next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const clamped = Math.max(-3, Math.min(3, z));
    return mean + clamped * standardDeviation;
  };

  return {
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min)),
    gaussian,
    jitter: (spread) => 1 + (next() * 2 - 1) * spread,
  };
}
