import type { StationId, TenantId } from '../types/ids.js';

/**
 * A physical petrol station operated by a tenant.
 *
 * TRD section 3 and PRD section 5 call this entity a Station; an earlier
 * increment called it a Site. The domain, the HTTP contract and the database
 * now all use Station.
 */
export type StationStatus = 'active' | 'inactive';

export interface Station {
  readonly id: StationId;
  readonly tenantId: TenantId;
  readonly name: string;
  /** Tenant-unique short code used on reports and by field staff. */
  readonly code: string;
  /** IANA timezone. Presentation only: every stored timestamp is UTC. */
  readonly timezone: string;
  readonly status: StationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Default timezone for the first market. See docs/assumptions.md A4. */
export const DEFAULT_STATION_TIMEZONE = 'Africa/Dar_es_Salaam';

export function isStationActive(station: Station): boolean {
  return station.status === 'active';
}
