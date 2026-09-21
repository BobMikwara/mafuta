import {
  API_KEY_SCOPES,
  generateApiKey,
  hashApiKey,
  toTenantId,
  type ApiKeyRecord,
  type ApiKeyRegistry,
} from '@fueltrack/core';

export interface ProvisionInput {
  readonly apiKeys: ApiKeyRegistry;
  readonly tenantId: string;
  readonly name: string;
  readonly scopes: ReadonlyArray<string>;
  readonly createdAt: string;
  /** Test seam only. Production callers let the crypto library generate it. */
  readonly secret?: string;
}

export interface ProvisionOutcome {
  readonly record: ApiKeyRecord;
  /** Returned exactly once, for the operator to store in their secret manager. */
  readonly secret: string;
}

/**
 * Installs a credential without the demo seed.
 *
 * The demo seed exists to populate sample tanks; provisioning a key for a real
 * tenant is a separate concern, and conflating the two is how a deployment ends
 * up with an empty credential store and an API that answers "API key rejected"
 * to a correct key. Only the hash is stored, and the secret is returned once.
 */
export async function provisionApiKey(input: ProvisionInput): Promise<ProvisionOutcome> {
  const tenantId = toTenantId(input.tenantId);
  const generated = generateApiKey({
    tenantId,
    name: input.name,
    scopes: input.scopes,
    createdAt: input.createdAt,
  });

  const secret = (input.secret ?? generated.secret).trim();
  if (secret.length < 16) {
    throw new Error('The API key must be at least 16 characters long');
  }

  const record: ApiKeyRecord = { ...generated.record, keyHash: hashApiKey(secret) };
  await input.apiKeys.save(record);
  return { record, secret };
}

/** Default scope set for an operator provisioned key. */
export function defaultScopes(): ReadonlyArray<string> {
  return [...API_KEY_SCOPES];
}

export interface VerifyInput {
  readonly apiKeys: ApiKeyRegistry;
  readonly secret: string;
  /** When given, the credential must belong to this tenant. */
  readonly tenantId?: string;
}

export type VerifyOutcome =
  | { readonly ok: true; readonly record: ApiKeyRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * Answers "does this deployment accept this key" without printing the key.
 *
 * A key can be perfectly valid and still be rejected, because it was issued for
 * another tenant, another database or another environment. Verifying against
 * the configured store is what separates those cases from a typo. Revoked and
 * expired credentials are reported as not found, because that is what the store
 * deliberately does with them.
 */
export async function verifyApiKey(input: VerifyInput): Promise<VerifyOutcome> {
  const secret = input.secret.trim();
  if (secret.length === 0) {
    return { ok: false, reason: 'no key was supplied on stdin' };
  }

  const record = await input.apiKeys.findBySecret(secret);
  if (record === null) {
    return {
      ok: false,
      reason:
        'the key was not found in this credential store (wrong key, revoked, or issued for another environment)',
    };
  }

  const expectedTenant = input.tenantId === undefined ? null : toTenantId(input.tenantId);
  if (expectedTenant !== null && record.tenantId !== expectedTenant) {
    // Both identifiers are non-secret; the key itself is never echoed.
    return {
      ok: false,
      reason: `the key belongs to tenant ${record.tenantId}, not ${expectedTenant}`,
    };
  }

  return { ok: true, record };
}
