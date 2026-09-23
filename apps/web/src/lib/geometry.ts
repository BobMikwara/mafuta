/**
 * Client-side copy of the cylinder capacity formula in
 * `packages/core/src/domain/geometry.ts`.
 *
 * The web build cannot import the core package (it pulls Node-only modules),
 * and the tank form has to reject a capacity that exceeds the geometry before
 * the request is sent. `apps/web/test/geometry.test.ts` compares this helper
 * with the domain function so the two cannot drift silently.
 *
 * Dimensions are millimetres. One litre is 1_000_000 cubic millimetres.
 */

export type CylinderKind = 'vertical-cylinder' | 'horizontal-cylinder';

const MM3_PER_LITRE = 1_000_000;

export function cylinderCapacityLitres(
  kind: CylinderKind,
  diameterMm: number,
  lengthOrHeightMm: number,
): number {
  // Both closed cylinders use the same full-volume formula. The kind is still
  // required so a caller cannot pass a strapping table through this helper.
  if (kind !== 'vertical-cylinder' && kind !== 'horizontal-cylinder') {
    return 0;
  }
  if (
    !Number.isFinite(diameterMm) ||
    !Number.isFinite(lengthOrHeightMm) ||
    diameterMm <= 0 ||
    lengthOrHeightMm <= 0
  ) {
    return 0;
  }
  const radius = diameterMm / 2;
  return (Math.PI * radius * radius * lengthOrHeightMm) / MM3_PER_LITRE;
}

/**
 * Safe working capacity suggested from geometry. Rounded down to 3 decimals so
 * it cannot exceed the geometric capacity by the 0.5 L tolerance the API allows
 * past, and so it matches the decimal precision stored for litres.
 */
export function suggestedCapacityLitres(
  kind: CylinderKind,
  diameterMm: number,
  lengthOrHeightMm: number,
): number {
  const geometric = cylinderCapacityLitres(kind, diameterMm, lengthOrHeightMm);
  if (geometric <= 0) {
    return 0;
  }
  return Math.floor(geometric * 1000) / 1000;
}
