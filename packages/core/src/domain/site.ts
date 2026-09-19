import type { SiteId, TenantId } from '../types/ids.js';

export type SiteStatus = 'active' | 'inactive';

export interface Site {
  readonly id: SiteId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly timezone: string;
  readonly status: SiteStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
