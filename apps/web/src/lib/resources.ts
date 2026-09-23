import { authorizedRequest, fetchHealth, type ServiceHealth } from './api.js';
import type { CreateStationBody, TankWriteBody, UpdateStationBody } from './fleet-forms.js';

export { fetchHealth };
export type { ServiceHealth };

export interface SessionInfo {
  readonly tenantId: string;
  readonly principalId: string;
  readonly scopes: ReadonlyArray<string>;
}

export interface Station {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly code: string;
  readonly timezone: string;
  readonly status: 'active' | 'inactive';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TankThresholds {
  readonly criticalLowPercent: number;
  readonly lowPercent: number;
  readonly highPercent: number;
  readonly waterAlarmMm: number;
  readonly rapidDropLitresPerHour: number;
  readonly deliveryLitres: number;
  readonly deliveryWindowMinutes: number;
  readonly staleAfterMinutes: number;
}

export interface TankGeometry {
  readonly kind: string;
  readonly diameterMm?: number;
  readonly heightMm?: number;
  readonly lengthMm?: number;
}

export interface Tank {
  readonly id: string;
  readonly tenantId: string;
  readonly stationId: string;
  readonly name: string;
  readonly product: string;
  readonly geometry: TankGeometry;
  readonly capacityLitres: number;
  readonly thresholds: TankThresholds;
  readonly status: 'active' | 'decommissioned';
  readonly calibrationSource: string | null;
  readonly calibrationAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Reading {
  readonly id: string;
  readonly tankId: string;
  readonly levelMm: number;
  readonly waterLevelMm: number;
  readonly netVolumeLitres: number;
  readonly grossVolumeLitres: number;
  readonly temperatureC: number | null;
  readonly recordedAt: string;
  readonly receivedAt: string;
  readonly source: string;
  readonly quality: string;
  readonly provenance?: string;
  readonly freshness?: string;
  readonly isStale?: boolean;
  readonly ageMinutes?: number | null;
}

export interface AlertRecord {
  readonly id: string;
  readonly tankId: string | null;
  readonly type: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly status: string;
  readonly message: string;
  readonly raisedAt: string;
  readonly assignedTo?: string | null;
  readonly acknowledgedAt?: string | null;
  readonly resolvedAt?: string | null;
}

export interface TankSummary {
  readonly tank: Tank;
  readonly station: Station | null;
  readonly latestReading: Reading | null;
  readonly netVolumeMl: number | null;
  readonly fillPercent: number | null;
  readonly stockStatus: 'critical' | 'low' | 'normal' | 'high' | null;
  readonly overfillRisk: boolean;
  readonly openAlertCount: number;
  readonly highestOpenSeverity: 'info' | 'warning' | 'critical' | null;
  readonly dataMissingOrStale: boolean;
}

export interface DashboardSummary {
  readonly generatedAt: string;
  readonly counts: {
    readonly stations: number;
    readonly tanks: number;
    readonly devices: number;
    readonly devicesOnline: number;
    readonly devicesOffline: number;
    readonly readingsLast24h: number;
    readonly eventsAwaitingDecision: number;
    readonly deliveriesLast30Days: number;
  };
  readonly stock: {
    readonly netVolumeMl: number;
    readonly capacityMl: number;
    readonly fillPercent: number;
    readonly tanksBelowLow: number;
    readonly tanksBelowCritical: number;
    readonly tanksWithoutReading: number;
    readonly tanksWithStaleData: number;
  };
  readonly alerts: {
    readonly open: number;
    readonly acknowledged: number;
    readonly bySeverity: {
      readonly info: number;
      readonly warning: number;
      readonly critical: number;
    };
    readonly latest: ReadonlyArray<AlertRecord>;
  };
  readonly products: ReadonlyArray<{
    readonly product: string;
    readonly tankCount: number;
    readonly capacityMl: number;
    readonly netVolumeMl: number;
    readonly fillPercent: number;
    readonly tanksWithoutReading: number;
  }>;
  readonly stations: ReadonlyArray<{
    readonly station: Station;
    readonly tankCount: number;
    readonly netVolumeMl: number;
    readonly fillPercent: number;
    readonly openAlertCount: number;
  }>;
  readonly tanksNeedingAttention: ReadonlyArray<TankSummary>;
  readonly recentDeliveries: ReadonlyArray<{
    readonly id: string;
    readonly tankName: string;
    readonly stationName: string;
    readonly recordedVolumeMl: number;
    readonly varianceMl: number;
    readonly confirmedAt: string;
    readonly reference: string | null;
  }>;
}

export interface SeriesPoint {
  readonly at: string;
  readonly netVolumeMl: number;
  readonly readingCount: number;
}

export interface TankSeries {
  readonly tankId: string;
  readonly tankName: string;
  readonly product: string;
  readonly capacityMl: number;
  readonly buckets: ReadonlyArray<SeriesPoint>;
}

export interface DeviceRecord {
  readonly id: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly serialNumber: string;
  readonly protocol: string;
  readonly firmwareVersion: string | null;
  readonly status: string;
  readonly connectionState: string;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeviceView {
  readonly device: DeviceRecord;
  readonly online: boolean;
  readonly minutesSinceLastSeen: number | null;
  readonly tankId: string | null;
  readonly tankName: string | null;
  readonly stationId: string | null;
  readonly stationName: string | null;
  readonly assignmentId: string | null;
  readonly assignedAt: string | null;
}

export interface DeviceDetail {
  readonly device: DeviceView;
  readonly assignmentHistory: ReadonlyArray<{
    readonly id: string;
    readonly tankId: string;
    readonly status: string;
    readonly assignedAt: string;
    readonly unassignedAt: string | null;
  }>;
  readonly rawMessageCount: number;
}

export interface FuelEvent {
  readonly id: string;
  readonly tankId: string;
  readonly type: string;
  readonly status: string;
  readonly confidence: number;
  readonly volumeChangeMl: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly notes: string | null;
  readonly evidence: {
    readonly rule: string;
    readonly possibleExplanations: ReadonlyArray<string>;
    readonly investigationRequired: boolean;
    readonly dataQuality: string;
  };
}

export interface EventView {
  readonly event: FuelEvent;
  readonly tankName: string | null;
  readonly stationName: string | null;
  readonly product: string | null;
  readonly volumeChangeLitres: number;
}

export interface DeliveryView {
  readonly delivery: {
    readonly id: string;
    readonly tankId: string;
    readonly measuredVolumeMl: number;
    readonly recordedVolumeMl: number;
    readonly reference: string | null;
    readonly supplier: string | null;
    readonly confirmedAt: string;
  };
  readonly tankName: string;
  readonly stationId: string;
  readonly stationName: string;
  readonly product: string;
  readonly varianceMl: number;
  readonly variancePercent: number | null;
}

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: 'left' | 'right';
}

export interface ReportTable {
  readonly report: string;
  readonly title: string;
  readonly generatedAt: string;
  readonly range?: { readonly from: string | null; readonly to: string | null };
  readonly columns: ReadonlyArray<ReportColumn>;
  readonly rows: ReadonlyArray<Record<string, string | number | null>>;
  readonly totals: Readonly<Record<string, string | number | null>> | null;
  readonly notes: ReadonlyArray<string>;
}

export interface AuditEntry {
  readonly id: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly actorReference: string | null;
  readonly occurredAt: string;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text.length === 0 ? '' : `?${text}`;
}

export function fetchSession(apiKey: string): Promise<SessionInfo> {
  return authorizedRequest(apiKey, { method: 'GET', path: '/v1/session' });
}

export function fetchStations(apiKey: string): Promise<{ stations: Station[] }> {
  return authorizedRequest(apiKey, { method: 'GET', path: '/v1/stations?limit=200' });
}

export function fetchStation(apiKey: string, stationId: string): Promise<{ station: Station }> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/stations/${encodeURIComponent(stationId)}`,
  });
}

export function createStation(
  apiKey: string,
  body: CreateStationBody,
): Promise<{ station: Station }> {
  return authorizedRequest(apiKey, { method: 'POST', path: '/v1/stations', body });
}

export function updateStation(
  apiKey: string,
  stationId: string,
  body: UpdateStationBody,
): Promise<{ station: Station }> {
  return authorizedRequest(apiKey, {
    method: 'PATCH',
    path: `/v1/stations/${encodeURIComponent(stationId)}`,
    body,
  });
}

export function fetchTankList(
  apiKey: string,
  filters: { stationId?: string | undefined; status?: string | undefined } = {},
): Promise<{ tanks: Tank[]; summaries: TankSummary[] }> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/tanks${query({ limit: 200, stationId: filters.stationId, status: filters.status })}`,
  });
}

export function fetchTank(apiKey: string, tankId: string): Promise<TankSummary> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/tanks/${encodeURIComponent(tankId)}`,
  });
}

export function createTank(apiKey: string, body: TankWriteBody): Promise<{ tank: Tank }> {
  return authorizedRequest(apiKey, { method: 'POST', path: '/v1/tanks', body });
}

export function updateTank(apiKey: string, tankId: string, body: object): Promise<{ tank: Tank }> {
  return authorizedRequest(apiKey, {
    method: 'PATCH',
    path: `/v1/tanks/${encodeURIComponent(tankId)}`,
    body,
  });
}

export function fetchDashboard(apiKey: string, stationId?: string): Promise<DashboardSummary> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/dashboard/summary${query({ stationId })}`,
  });
}

export function fetchSeries(
  apiKey: string,
  tankId: string,
  hours = 24,
): Promise<{ series: TankSeries }> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/tanks/${encodeURIComponent(tankId)}/series?hours=${hours}&buckets=24`,
  });
}

export function fetchReadings(
  apiKey: string,
  tankId: string,
  limit = 50,
): Promise<{ readings: Reading[] }> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/tanks/${encodeURIComponent(tankId)}/readings?limit=${limit}`,
  });
}

export function recordDip(
  apiKey: string,
  tankId: string,
  body: {
    observedAt: string;
    levelMm: number;
    waterLevelMm: number;
    temperatureC: number | null;
    source: 'manual';
    idempotencyKey: string;
  },
): Promise<{ reading: Reading; duplicate: boolean }> {
  return authorizedRequest(apiKey, {
    method: 'POST',
    path: `/v1/tanks/${encodeURIComponent(tankId)}/readings`,
    body,
  });
}

export function fetchDevices(apiKey: string): Promise<{ devices: DeviceView[] }> {
  return authorizedRequest(apiKey, { method: 'GET', path: '/v1/devices?limit=200' });
}

export function fetchDevice(apiKey: string, deviceId: string): Promise<DeviceDetail> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/devices/${encodeURIComponent(deviceId)}`,
  });
}

export function registerDevice(
  apiKey: string,
  body: {
    manufacturer: string;
    model: string;
    serialNumber: string;
    protocol: string;
    firmwareVersion?: string;
  },
): Promise<{ device: DeviceRecord }> {
  return authorizedRequest(apiKey, { method: 'POST', path: '/v1/devices', body });
}

export function assignDevice(
  apiKey: string,
  deviceId: string,
  tankId: string,
): Promise<{ assignment: { tankId: string; status: string } }> {
  return authorizedRequest(apiKey, {
    method: 'POST',
    path: `/v1/devices/${encodeURIComponent(deviceId)}/assign`,
    body: { tankId },
  });
}

export function unassignDevice(
  apiKey: string,
  deviceId: string,
): Promise<{ assignment: { status: string } }> {
  return authorizedRequest(apiKey, {
    method: 'POST',
    path: `/v1/devices/${encodeURIComponent(deviceId)}/unassign`,
    body: {},
  });
}

export function fetchAlerts(
  apiKey: string,
  filters: { status?: string; type?: string } = {},
): Promise<{ alerts: AlertRecord[] }> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/alerts${query({ limit: 200, status: filters.status, type: filters.type })}`,
  });
}

export function acknowledgeAlert(
  apiKey: string,
  alertId: string,
  note?: string,
): Promise<{ alert: AlertRecord }> {
  return authorizedRequest(apiKey, {
    method: 'POST',
    path: `/v1/alerts/${encodeURIComponent(alertId)}/acknowledge`,
    body: note === undefined || note.trim() === '' ? {} : { note: note.trim() },
  });
}

export function resolveAlert(
  apiKey: string,
  alertId: string,
  note?: string,
): Promise<{ alert: AlertRecord }> {
  return authorizedRequest(apiKey, {
    method: 'POST',
    path: `/v1/alerts/${encodeURIComponent(alertId)}/resolve`,
    body: note === undefined || note.trim() === '' ? {} : { note: note.trim() },
  });
}

export function assignAlert(
  apiKey: string,
  alertId: string,
  assignee: string | null,
): Promise<{ alert: AlertRecord }> {
  return authorizedRequest(apiKey, {
    method: 'POST',
    path: `/v1/alerts/${encodeURIComponent(alertId)}/assign`,
    body: { assignee },
  });
}

export function fetchEvents(apiKey: string, status?: string): Promise<{ events: EventView[] }> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/events${query({ limit: 200, status })}`,
  });
}

export function confirmEvent(
  apiKey: string,
  eventId: string,
  body: { recordedVolumeLitres?: number; reference?: string; supplier?: string; note?: string },
): Promise<{ varianceMl: number }> {
  return authorizedRequest(apiKey, {
    method: 'POST',
    path: `/v1/events/${encodeURIComponent(eventId)}/confirm`,
    body,
  });
}

export function rejectEvent(
  apiKey: string,
  eventId: string,
  note: string,
): Promise<{ event: FuelEvent }> {
  return authorizedRequest(apiKey, {
    method: 'POST',
    path: `/v1/events/${encodeURIComponent(eventId)}/reject`,
    body: { note },
  });
}

export function fetchDeliveries(apiKey: string): Promise<{ deliveries: DeliveryView[] }> {
  return authorizedRequest(apiKey, { method: 'GET', path: '/v1/deliveries?limit=200' });
}

export function fetchReport(
  apiKey: string,
  report: string,
  filters: { stationId?: string; tankId?: string } = {},
): Promise<ReportTable> {
  return authorizedRequest(apiKey, {
    method: 'GET',
    path: `/v1/reports/${encodeURIComponent(report)}${query(filters)}`,
  });
}

export async function downloadReportCsv(apiKey: string, report: string): Promise<string> {
  const csv = await authorizedRequest<string>(apiKey, {
    method: 'GET',
    path: `/v1/reports/${encodeURIComponent(report)}?format=csv`,
    accept: 'text/csv',
  });
  triggerCsvDownload(`${report}.csv`, csv);
  return csv;
}

function triggerCsvDownload(filename: string, csv: string): void {
  const scope = globalThis as {
    document?: {
      createElement(tag: string): { href: string; download: string; click(): void };
    };
    URL?: {
      createObjectURL?: (blob: Blob) => string;
      revokeObjectURL?: (url: string) => void;
    };
  };
  const create = scope.URL?.createObjectURL;
  if (scope.document === undefined || create === undefined) {
    return;
  }
  const url = create(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = scope.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  scope.URL?.revokeObjectURL?.(url);
}

export function fetchAudit(apiKey: string): Promise<{ auditLogs: AuditEntry[] }> {
  return authorizedRequest(apiKey, { method: 'GET', path: '/v1/audit-logs?limit=50' });
}
