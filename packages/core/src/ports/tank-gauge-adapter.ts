import type { ProbeSample } from '../domain/normalize.js';
import type { Tank } from '../domain/tank.js';
import type { Result } from '../types/result.js';

/**
 * Hardware boundary contract.
 *
 * This interface deliberately describes physical observations only
 * (level, water level, temperature). It contains no vendor protocol, register
 * map, baud rate or frame layout because none has been supplied. Any real
 * integration must be documented by the tank gauge vendor before an adapter is
 * written, and must implement exactly this interface so that upper layers do
 * not change.
 */
export interface AdapterCapabilities {
  readonly supportsTemperature: boolean;
  readonly supportsWaterLevel: boolean;
  readonly supportsDensity: boolean;
  /** Minimum interval the device tolerates between polls, in seconds. */
  readonly minPollingIntervalSeconds: number;
  /** True when this adapter produces synthetic data. Never false for simulators. */
  readonly simulated: boolean;
}

export type AdapterErrorCode =
  'unavailable' | 'timeout' | 'protocol-error' | 'unsupported' | 'unauthorized' | 'unknown';

export interface AdapterError {
  readonly code: AdapterErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ReadTankRequest {
  readonly tank: Tank;
  /** Optional observation timestamp, defaults to adapter clock. */
  readonly at?: Date;
  readonly correlationId?: string;
}

export interface AdapterHealth {
  readonly healthy: boolean;
  readonly detail: string;
  readonly checkedAt: string;
}

export interface TankGaugeAdapter {
  readonly vendor: string;
  readonly model: string | null;
  readonly kind: 'simulated' | 'hardware';
  readonly capabilities: AdapterCapabilities;
  readTank(request: ReadTankRequest): Promise<Result<ProbeSample, AdapterError>>;
  healthCheck(): Promise<Result<AdapterHealth, AdapterError>>;
}
