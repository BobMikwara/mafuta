/** Time is a port so that alarm staleness and simulators stay deterministic. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date | string): Clock {
  const value = typeof at === 'string' ? new Date(at) : at;
  return { now: () => new Date(value.getTime()) };
}

export interface ManualClock extends Clock {
  set(at: Date | string): void;
  advanceMilliseconds(delta: number): void;
}

export function manualClock(startAt: Date | string = '2026-01-01T00:00:00.000Z'): ManualClock {
  let current = typeof startAt === 'string' ? new Date(startAt) : new Date(startAt.getTime());
  return {
    now: () => new Date(current.getTime()),
    set: (at) => {
      current = typeof at === 'string' ? new Date(at) : new Date(at.getTime());
    },
    advanceMilliseconds: (delta) => {
      current = new Date(current.getTime() + delta);
    },
  };
}

export function toIsoString(at: Date): string {
  return at.toISOString();
}
