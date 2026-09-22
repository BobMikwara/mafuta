import { randomUUID } from 'node:crypto';
import { InvalidIdentifierError } from '../errors.js';

/**
 * Phantom brand. Branded identifiers make it a compile time error to pass a
 * tank id where a tenant id is expected, which is the single cheapest defence
 * against cross-entity mix-ups in a multi-tenant codebase.
 */
export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type TenantId = Brand<string, 'TenantId'>;
export type StationId = Brand<string, 'StationId'>;
export type TankId = Brand<string, 'TankId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type ReadingId = Brand<string, 'ReadingId'>;
export type AlertId = Brand<string, 'AlertId'>;
export type FuelEventId = Brand<string, 'FuelEventId'>;
export type DeliveryId = Brand<string, 'DeliveryId'>;
export type AssignmentId = Brand<string, 'AssignmentId'>;
export type RawMessageId = Brand<string, 'RawMessageId'>;
export type ApiKeyId = Brand<string, 'ApiKeyId'>;
export type PrincipalId = Brand<string, 'PrincipalId'>;

const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function assertIdentifier(value: string, name: string): void {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new InvalidIdentifierError(name);
  }
}

export function toTenantId(value: string): TenantId {
  assertIdentifier(value, 'tenantId');
  return value as TenantId;
}

export function toStationId(value: string): StationId {
  assertIdentifier(value, 'stationId');
  return value as StationId;
}

export function toTankId(value: string): TankId {
  assertIdentifier(value, 'tankId');
  return value as TankId;
}

export function toDeviceId(value: string): DeviceId {
  assertIdentifier(value, 'deviceId');
  return value as DeviceId;
}

export function toReadingId(value: string): ReadingId {
  assertIdentifier(value, 'readingId');
  return value as ReadingId;
}

export function toAlertId(value: string): AlertId {
  assertIdentifier(value, 'alertId');
  return value as AlertId;
}

export function toFuelEventId(value: string): FuelEventId {
  assertIdentifier(value, 'eventId');
  return value as FuelEventId;
}

export function toApiKeyId(value: string): ApiKeyId {
  assertIdentifier(value, 'apiKeyId');
  return value as ApiKeyId;
}

export function isIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

/** Generates a new prefixed, URL and log safe identifier. */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
