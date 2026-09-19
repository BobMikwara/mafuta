/**
 * Tank geometry and level-to-volume conversion.
 *
 * All dimensions are millimetres and all volumes are litres
 * (1 litre = 1_000_000 cubic millimetres).
 *
 * These are standard closed-form volume formulas plus vendor supplied
 * strapping tables. No hardware vendor protocol is encoded here.
 */
export interface StrappingPoint {
  /** Product level measured from the bottom of the tank, in millimetres. */
  readonly levelMm: number;
  /** Volume in litres at that level. */
  readonly volumeLitres: number;
}

export interface VerticalCylinderGeometry {
  readonly kind: 'vertical-cylinder';
  readonly diameterMm: number;
  readonly heightMm: number;
}

export interface HorizontalCylinderGeometry {
  readonly kind: 'horizontal-cylinder';
  readonly diameterMm: number;
  readonly lengthMm: number;
}

export interface StrappingTableGeometry {
  readonly kind: 'strapping-table';
  readonly points: ReadonlyArray<StrappingPoint>;
}

export type TankGeometry =
  VerticalCylinderGeometry | HorizontalCylinderGeometry | StrappingTableGeometry;

export type TankGeometryKind = TankGeometry['kind'];

const MM3_PER_LITRE = 1_000_000;

function circularSegmentArea(radiusMm: number, fillHeightMm: number): number {
  const h = Math.min(Math.max(fillHeightMm, 0), radiusMm * 2);
  const distanceFromCentre = radiusMm - h;
  const angle = Math.acos(Math.min(1, Math.max(-1, distanceFromCentre / radiusMm)));
  const triangleTerm =
    distanceFromCentre *
    Math.sqrt(Math.max(0, radiusMm * radiusMm - distanceFromCentre * distanceFromCentre));
  return radiusMm * radiusMm * angle - triangleTerm;
}

function strappingVolume(points: ReadonlyArray<StrappingPoint>, levelMm: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) {
    return 0;
  }
  if (levelMm <= first.levelMm) {
    return first.volumeLitres;
  }
  if (levelMm >= last.levelMm) {
    return last.volumeLitres;
  }
  for (let index = 1; index < points.length; index += 1) {
    const lower = points[index - 1];
    const upper = points[index];
    if (lower === undefined || upper === undefined) {
      continue;
    }
    if (levelMm <= upper.levelMm) {
      const spanMm = upper.levelMm - lower.levelMm;
      if (spanMm <= 0) {
        return upper.volumeLitres;
      }
      const ratio = (levelMm - lower.levelMm) / spanMm;
      return lower.volumeLitres + ratio * (upper.volumeLitres - lower.volumeLitres);
    }
  }
  return last.volumeLitres;
}

/** Maximum measurable product level for a geometry, in millimetres. */
export function maxLevelMm(geometry: TankGeometry): number {
  switch (geometry.kind) {
    case 'vertical-cylinder':
      return geometry.heightMm;
    case 'horizontal-cylinder':
      return geometry.diameterMm;
    case 'strapping-table': {
      const last = geometry.points[geometry.points.length - 1];
      return last === undefined ? 0 : last.levelMm;
    }
    default: {
      const exhaustive: never = geometry;
      return exhaustive;
    }
  }
}

/** Total geometric capacity of the tank in litres. */
export function tankCapacityLitres(geometry: TankGeometry): number {
  switch (geometry.kind) {
    case 'vertical-cylinder': {
      const radius = geometry.diameterMm / 2;
      return (Math.PI * radius * radius * geometry.heightMm) / MM3_PER_LITRE;
    }
    case 'horizontal-cylinder': {
      const radius = geometry.diameterMm / 2;
      return (Math.PI * radius * radius * geometry.lengthMm) / MM3_PER_LITRE;
    }
    case 'strapping-table': {
      const last = geometry.points[geometry.points.length - 1];
      return last === undefined ? 0 : last.volumeLitres;
    }
    default: {
      const exhaustive: never = geometry;
      return exhaustive;
    }
  }
}

/**
 * Inverse of `volumeAtLevelLitres`. Volume as a function of level is monotonic
 * for every supported geometry, so a bounded bisection converges without
 * needing a per-geometry closed form.
 */
export function levelForVolumeLitres(geometry: TankGeometry, litres: number): number {
  if (!Number.isFinite(litres) || litres <= 0) {
    return 0;
  }
  const capacity = tankCapacityLitres(geometry);
  if (litres >= capacity) {
    return maxLevelMm(geometry);
  }
  let low = 0;
  let high = maxLevelMm(geometry);
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (volumeAtLevelLitres(geometry, middle) < litres) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

/**
 * Volume of product in litres at a given level. Levels below zero clamp to
 * zero and levels above the geometry maximum clamp to capacity; callers should
 * treat out-of-range levels as suspect readings before calling this.
 */
export function volumeAtLevelLitres(geometry: TankGeometry, levelMm: number): number {
  if (!Number.isFinite(levelMm) || levelMm <= 0) {
    return 0;
  }
  const ceiling = maxLevelMm(geometry);
  const clamped = Math.min(levelMm, ceiling);

  switch (geometry.kind) {
    case 'vertical-cylinder': {
      const radius = geometry.diameterMm / 2;
      return (Math.PI * radius * radius * clamped) / MM3_PER_LITRE;
    }
    case 'horizontal-cylinder': {
      const radius = geometry.diameterMm / 2;
      return (circularSegmentArea(radius, clamped) * geometry.lengthMm) / MM3_PER_LITRE;
    }
    case 'strapping-table':
      return strappingVolume(geometry.points, clamped);
    default: {
      const exhaustive: never = geometry;
      return exhaustive;
    }
  }
}
