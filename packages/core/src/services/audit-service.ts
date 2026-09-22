import type { AuditActorType, AuditLogEntry, AuditMetadata } from '../domain/audit.js';
import { newId } from '../types/ids.js';
import type { TenantId } from '../types/ids.js';
import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { AuditLogRepository, AuditQuery } from '../ports/repositories.js';

/**
 * Who performed an action. `reference` is a principal label such as
 * `key:<apiKeyId>` or `user:<userId>`; it is never a secret.
 */
export interface AuditActor {
  readonly type: AuditActorType;
  readonly reference: string | null;
  readonly deviceId?: string | null;
  /** Salted hash of the client address, produced by the API layer. */
  readonly ipHash?: string | null;
}

export interface AuditServiceDependencies {
  readonly auditLogs: AuditLogRepository;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Writes the audit trail required by TRD section 7 and PRD section 5.
 *
 * Auditing must never break the operation it records: a failure to append is
 * logged at error level and swallowed, because refusing a delivery confirmation
 * because the audit table is unavailable would be a worse outcome than a gap in
 * the trail, which the error log makes visible.
 */
export class AuditService {
  private readonly auditLogs: AuditLogRepository;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(dependencies: AuditServiceDependencies) {
    this.auditLogs = dependencies.auditLogs;
    this.clock = dependencies.clock;
    this.logger = dependencies.logger;
  }

  async list(tenantId: TenantId, query: AuditQuery = {}): Promise<ReadonlyArray<AuditLogEntry>> {
    return listAuditLogs(this.auditLogs, tenantId, query);
  }

  async record(input: {
    tenantId: TenantId | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    actor: AuditActor;
    metadata?: AuditMetadata;
  }): Promise<AuditLogEntry | null> {
    const entry: AuditLogEntry = {
      id: newId('aud'),
      tenantId: input.tenantId,
      actorType: input.actor.type,
      actorReference: input.actor.reference,
      actorDeviceId: input.actor.deviceId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ipHash: input.actor.ipHash ?? null,
      metadata: scrubMetadata(input.metadata ?? {}),
      occurredAt: this.clock.now().toISOString(),
    };

    try {
      return await this.auditLogs.append(entry);
    } catch (error) {
      this.logger.error('audit.append.failed', {
        action: entry.action,
        resourceType: entry.resourceType,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
  }
}

/**
 * Reads the tenant's audit trail for the audit report and the audit log view.
 * Tenant scoping is enforced by the repository, which requires the tenant id.
 */
export async function listAuditLogs(
  auditLogs: AuditLogRepository,
  tenantId: TenantId,
  query: AuditQuery = {},
): Promise<ReadonlyArray<AuditLogEntry>> {
  return auditLogs.list(tenantId, query);
}

const FORBIDDEN_METADATA_KEYS = [
  'secret',
  'password',
  'token',
  'apikey',
  'api_key',
  'authorization',
];

/**
 * Defence in depth: a caller must not be able to write a credential into the
 * audit trail by accident. Any key that looks like a secret is dropped rather
 * than stored.
 */
export function scrubMetadata(metadata: AuditMetadata): AuditMetadata {
  const cleaned: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.some((forbidden) => normalized.includes(forbidden))) {
      continue;
    }
    if (typeof value === 'string' && value.length > 500) {
      cleaned[key] = `${value.slice(0, 500)}...`;
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}
