import type { ApiIssue } from './api.js';
import { wallTimeToUtcIso } from './format.js';
import { cylinderCapacityLitres, suggestedCapacityLitres, type CylinderKind } from './geometry.js';
import {
  DEFAULT_STATION_TIMEZONE,
  FUEL_PRODUCTS,
  isFuelProduct,
  STATION_TIMEZONES,
  type FuelProduct,
} from './labels.js';

export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export interface StationFormValues {
  readonly name: string;
  readonly code: string;
  readonly timezone: string;
  readonly status: 'active' | 'inactive';
}

export interface TankFormValues {
  readonly stationId: string;
  readonly name: string;
  readonly product: string;
  readonly geometryKind: CylinderKind;
  readonly diameterMm: string;
  readonly lengthOrHeightMm: string;
  readonly capacityLitres: string;
  readonly criticalLowPercent: string;
  readonly lowPercent: string;
  readonly highPercent: string;
  readonly waterAlarmMm: string;
  readonly rapidDropLitresPerHour: string;
  readonly deliveryLitres: string;
  readonly deliveryWindowMinutes: string;
  readonly staleAfterMinutes: string;
  readonly calibrationSource: string;
  readonly status: 'active' | 'decommissioned';
}

export interface DeviceFormValues {
  readonly manufacturer: string;
  readonly model: string;
  readonly serialNumber: string;
  readonly protocol: string;
  readonly firmwareVersion: string;
}

export interface DipFormValues {
  readonly observedAtLocal: string;
  readonly levelMm: string;
  readonly waterLevelMm: string;
  readonly temperatureC: string;
}

export const DEFAULT_TANK_FORM: TankFormValues = {
  stationId: '',
  name: '',
  product: 'diesel',
  geometryKind: 'horizontal-cylinder',
  diameterMm: '',
  lengthOrHeightMm: '',
  capacityLitres: '',
  criticalLowPercent: '10',
  lowPercent: '20',
  highPercent: '95',
  waterAlarmMm: '50',
  rapidDropLitresPerHour: '400',
  deliveryLitres: '300',
  deliveryWindowMinutes: '30',
  staleAfterMinutes: '60',
  calibrationSource: '',
  status: 'active',
};

const TIMEZONE_PATTERN = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/;
const CODE_PATTERN = /^[A-Za-z0-9-]+$/;
const SERIAL_PATTERN = /^[A-Za-z0-9._:-]+$/;
const DEVICE_PROTOCOLS = ['simulated', 'http', 'mqtt', 'modbus_rtu', 'modbus_tcp', 'other'];

export function emptyStationForm(): StationFormValues {
  return {
    name: '',
    code: '',
    timezone: DEFAULT_STATION_TIMEZONE,
    status: 'active',
  };
}

export function issueMap(
  issues: ReadonlyArray<FieldIssue | ApiIssue>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (!map.has(issue.path)) {
      map.set(issue.path, issue.message);
    }
  }
  return map;
}

function requiredText(value: string, path: string, label: string, max: number): FieldIssue | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { path, message: `${label} is required.` };
  }
  if (trimmed.length > max) {
    return { path, message: `${label} must be ${max} characters or fewer.` };
  }
  return null;
}

function parsePositive(
  value: string,
  path: string,
  label: string,
): { value: number } | { issue: FieldIssue } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { issue: { path, message: `${label} is required.` } };
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { issue: { path, message: `${label} must be a positive number.` } };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { issue: { path, message: `${label} must be greater than zero.` } };
  }
  return { value: parsed };
}

function parseNonNegative(
  value: string,
  path: string,
  label: string,
): { value: number } | { issue: FieldIssue } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { issue: { path, message: `${label} is required.` } };
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { issue: { path, message: `${label} cannot be negative.` } };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { issue: { path, message: `${label} cannot be negative.` } };
  }
  return { value: parsed };
}

export function validateStation(values: StationFormValues): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const name = requiredText(values.name, 'name', 'Station name', 120);
  if (name !== null) issues.push(name);

  const code = values.code.trim();
  if (code.length < 2 || code.length > 32 || !CODE_PATTERN.test(code)) {
    issues.push({
      path: 'code',
      message: 'Station code must be 2 to 32 letters, digits or hyphens.',
    });
  }

  const timezone = values.timezone.trim();
  if (timezone.length < 2 || timezone.length > 64 || !TIMEZONE_PATTERN.test(timezone)) {
    issues.push({
      path: 'timezone',
      message: 'Timezone must be an IANA zone name, such as Africa/Dar_es_Salaam.',
    });
  }
  if (values.status !== 'active' && values.status !== 'inactive') {
    issues.push({ path: 'status', message: 'Status must be active or inactive.' });
  }
  return issues;
}

export interface CreateStationBody {
  readonly name: string;
  readonly code: string;
  readonly timezone: string;
}

export interface UpdateStationBody {
  readonly name: string;
  readonly timezone: string;
  readonly status: 'active' | 'inactive';
}

export function buildCreateStationBody(values: StationFormValues): CreateStationBody {
  return {
    name: values.name.trim(),
    code: values.code.trim(),
    timezone: values.timezone.trim() || DEFAULT_STATION_TIMEZONE,
  };
}

export function buildUpdateStationBody(values: StationFormValues): UpdateStationBody {
  return {
    name: values.name.trim(),
    timezone: values.timezone.trim(),
    status: values.status,
  };
}

export function knownTimezones(current: string): ReadonlyArray<{ value: string; label: string }> {
  if (STATION_TIMEZONES.some((zone) => zone.value === current) || current.trim() === '') {
    return STATION_TIMEZONES;
  }
  return [{ value: current, label: current }, ...STATION_TIMEZONES];
}

interface ParsedThresholds {
  readonly criticalLowPercent: number;
  readonly lowPercent: number;
  readonly highPercent: number;
  readonly waterAlarmMm: number;
  readonly rapidDropLitresPerHour: number;
  readonly deliveryLitres: number;
  readonly deliveryWindowMinutes: number;
  readonly staleAfterMinutes: number;
}

export function validateTank(values: TankFormValues): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (values.stationId.trim().length < 2) {
    issues.push({ path: 'stationId', message: 'Choose the station this tank belongs to.' });
  }
  const name = requiredText(values.name, 'name', 'Tank name', 120);
  if (name !== null) issues.push(name);
  if (!isFuelProduct(values.product)) {
    issues.push({ path: 'product', message: 'Choose a fuel product.' });
  }
  if (
    values.geometryKind !== 'horizontal-cylinder' &&
    values.geometryKind !== 'vertical-cylinder'
  ) {
    issues.push({ path: 'geometryKind', message: 'Choose a tank shape.' });
  }

  const diameter = parsePositive(values.diameterMm, 'diameterMm', 'Diameter');
  const spanLabel = values.geometryKind === 'vertical-cylinder' ? 'Height' : 'Length';
  const span = parsePositive(values.lengthOrHeightMm, 'lengthOrHeightMm', spanLabel);
  const capacity = parsePositive(values.capacityLitres, 'capacityLitres', 'Safe working capacity');
  if ('issue' in diameter) issues.push(diameter.issue);
  if ('issue' in span) issues.push(span.issue);
  if ('issue' in capacity) issues.push(capacity.issue);

  if ('value' in diameter && 'value' in span && 'value' in capacity) {
    const geometric = cylinderCapacityLitres(values.geometryKind, diameter.value, span.value);
    if (capacity.value > geometric + 0.5) {
      issues.push({
        path: 'capacityLitres',
        message: `Capacity cannot exceed the geometric capacity of ${geometric.toFixed(1)} L.`,
      });
    }
    if (capacity.value > 5_000_000) {
      issues.push({ path: 'capacityLitres', message: 'Capacity must be 5,000,000 L or less.' });
    }
  }

  const thresholds = parseThresholds(values);
  issues.push(...thresholds.issues);
  if (values.status !== 'active' && values.status !== 'decommissioned') {
    issues.push({ path: 'status', message: 'Status must be active or decommissioned.' });
  }
  if (values.calibrationSource.trim().length > 200) {
    issues.push({
      path: 'calibrationSource',
      message: 'Calibration source must be 200 characters or fewer.',
    });
  }
  return issues;
}

function parseThresholds(values: TankFormValues): {
  issues: FieldIssue[];
  thresholds: ParsedThresholds | null;
} {
  const issues: FieldIssue[] = [];
  const critical = parseNonNegative(
    values.criticalLowPercent,
    'criticalLowPercent',
    'Critical level',
  );
  const low = parseNonNegative(values.lowPercent, 'lowPercent', 'Low-stock level');
  const high = parseNonNegative(values.highPercent, 'highPercent', 'High level');
  const water = parseNonNegative(values.waterAlarmMm, 'waterAlarmMm', 'Water alarm');
  const drop = parseNonNegative(
    values.rapidDropLitresPerHour,
    'rapidDropLitresPerHour',
    'Decrease rate',
  );
  const delivery = parseNonNegative(values.deliveryLitres, 'deliveryLitres', 'Delivery volume');
  const windowMinutes = parsePositive(
    values.deliveryWindowMinutes,
    'deliveryWindowMinutes',
    'Delivery window',
  );
  const stale = parsePositive(values.staleAfterMinutes, 'staleAfterMinutes', 'Stale after');

  for (const parsed of [critical, low, high, water, drop, delivery, windowMinutes, stale]) {
    if ('issue' in parsed) issues.push(parsed.issue);
  }
  if (issues.length > 0) {
    return { issues, thresholds: null };
  }
  if (
    !('value' in critical) ||
    !('value' in low) ||
    !('value' in high) ||
    !('value' in water) ||
    !('value' in drop) ||
    !('value' in delivery) ||
    !('value' in windowMinutes) ||
    !('value' in stale)
  ) {
    return { issues, thresholds: null };
  }
  if (critical.value > 100 || low.value > 100 || high.value > 100) {
    issues.push({
      path: 'highPercent',
      message: 'Stock thresholds must be between 0 and 100 percent.',
    });
  }
  if (critical.value >= low.value) {
    issues.push({
      path: 'criticalLowPercent',
      message: 'Critical level must be lower than the low-stock level.',
    });
  }
  if (low.value >= high.value) {
    issues.push({
      path: 'lowPercent',
      message: 'Low-stock level must be lower than the high level.',
    });
  }
  if (issues.length > 0) {
    return { issues, thresholds: null };
  }
  return {
    issues,
    thresholds: {
      criticalLowPercent: critical.value,
      lowPercent: low.value,
      highPercent: high.value,
      waterAlarmMm: water.value,
      rapidDropLitresPerHour: drop.value,
      deliveryLitres: delivery.value,
      deliveryWindowMinutes: windowMinutes.value,
      staleAfterMinutes: stale.value,
    },
  };
}

export interface TankWriteBody {
  readonly stationId?: string;
  readonly name: string;
  readonly product: FuelProduct;
  readonly geometry:
    | {
        readonly kind: 'horizontal-cylinder';
        readonly diameterMm: number;
        readonly lengthMm: number;
      }
    | {
        readonly kind: 'vertical-cylinder';
        readonly diameterMm: number;
        readonly heightMm: number;
      };
  readonly capacityLitres: number;
  readonly thresholds: ParsedThresholds;
  readonly calibrationSource?: string;
  readonly status?: 'active' | 'decommissioned';
}

export function buildCreateTankBody(values: TankFormValues): TankWriteBody {
  const parsed = parseThresholds(values);
  if (parsed.thresholds === null || !isFuelProduct(values.product)) {
    throw new Error('Tank form is not valid');
  }
  const diameter = Number(values.diameterMm);
  const span = Number(values.lengthOrHeightMm);
  const calibration = values.calibrationSource.trim();
  return {
    stationId: values.stationId.trim(),
    name: values.name.trim(),
    product: values.product,
    geometry:
      values.geometryKind === 'vertical-cylinder'
        ? { kind: 'vertical-cylinder', diameterMm: diameter, heightMm: span }
        : { kind: 'horizontal-cylinder', diameterMm: diameter, lengthMm: span },
    capacityLitres: Number(values.capacityLitres),
    thresholds: parsed.thresholds,
    ...(calibration.length === 0 ? {} : { calibrationSource: calibration }),
  };
}

export type UpdateTankBody = ReturnType<typeof buildUpdateTankBody>;

export function buildUpdateTankBody(
  values: TankFormValues,
  options: { includeGeometry: boolean } = { includeGeometry: true },
): {
  name: string;
  product: FuelProduct;
  thresholds: ParsedThresholds;
  status: 'active' | 'decommissioned';
  calibrationSource: string | null;
  geometry?: TankWriteBody['geometry'];
  capacityLitres?: number;
} {
  const parsed = parseThresholds(values);
  if (parsed.thresholds === null || !isFuelProduct(values.product)) {
    throw new Error('Tank form is not valid');
  }
  const calibration = values.calibrationSource.trim();
  return {
    name: values.name.trim(),
    product: values.product,
    thresholds: parsed.thresholds,
    status: values.status,
    calibrationSource: calibration.length === 0 ? null : calibration,
    ...(options.includeGeometry
      ? {
          geometry: buildCreateTankBody(values).geometry,
          capacityLitres: Number(values.capacityLitres),
        }
      : {}),
  };
}

export function suggestTankCapacity(values: TankFormValues): number | null {
  const diameter = Number(values.diameterMm);
  const span = Number(values.lengthOrHeightMm);
  if (!Number.isFinite(diameter) || !Number.isFinite(span) || diameter <= 0 || span <= 0) {
    return null;
  }
  const suggested = suggestedCapacityLitres(values.geometryKind, diameter, span);
  return suggested > 0 ? suggested : null;
}

export function validateDevice(values: DeviceFormValues): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const manufacturer = requiredText(values.manufacturer, 'manufacturer', 'Manufacturer', 80);
  const model = requiredText(values.model, 'model', 'Model', 80);
  if (manufacturer !== null) issues.push(manufacturer);
  if (model !== null) issues.push(model);
  const serial = values.serialNumber.trim();
  if (serial.length === 0 || serial.length > 80 || !SERIAL_PATTERN.test(serial)) {
    issues.push({
      path: 'serialNumber',
      message: 'Serial number must be 1 to 80 letters, digits or . _ : -',
    });
  }
  if (!DEVICE_PROTOCOLS.includes(values.protocol)) {
    issues.push({ path: 'protocol', message: 'Choose a protocol.' });
  }
  if (values.firmwareVersion.trim().length > 40) {
    issues.push({
      path: 'firmwareVersion',
      message: 'Firmware version must be 40 characters or fewer.',
    });
  }
  return issues;
}

export function buildRegisterDeviceBody(values: DeviceFormValues): {
  manufacturer: string;
  model: string;
  serialNumber: string;
  protocol: string;
  firmwareVersion?: string;
} {
  const firmware = values.firmwareVersion.trim();
  return {
    manufacturer: values.manufacturer.trim(),
    model: values.model.trim(),
    serialNumber: values.serialNumber.trim(),
    protocol: values.protocol,
    ...(firmware.length === 0 ? {} : { firmwareVersion: firmware }),
  };
}

export function validateDip(values: DipFormValues): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(values.observedAtLocal.trim())) {
    issues.push({ path: 'observedAtLocal', message: 'Choose the date and time of the dip.' });
  }
  const level = parseNonNegative(values.levelMm, 'levelMm', 'Product level');
  const water = parseNonNegative(values.waterLevelMm, 'waterLevelMm', 'Water level');
  if ('issue' in level) issues.push(level.issue);
  if ('issue' in water) issues.push(water.issue);
  if ('value' in level && 'value' in water && water.value > level.value) {
    issues.push({
      path: 'waterLevelMm',
      message: 'Water level cannot be higher than the product level.',
    });
  }
  const temperature = values.temperatureC.trim();
  if (temperature.length > 0) {
    const parsed = Number(temperature);
    if (!Number.isFinite(parsed) || parsed < -60 || parsed > 120) {
      issues.push({ path: 'temperatureC', message: 'Temperature must be between -60 and 120 C.' });
    }
  }
  return issues;
}

export function buildDipBody(
  values: DipFormValues,
  timeZone: string,
  idempotencyKey: string,
): {
  observedAt: string;
  levelMm: number;
  waterLevelMm: number;
  temperatureC: number | null;
  source: 'manual';
  idempotencyKey: string;
} | null {
  const observedAt = wallTimeToUtcIso(values.observedAtLocal, timeZone);
  if (observedAt === null) {
    return null;
  }
  const temperature = values.temperatureC.trim();
  return {
    observedAt,
    levelMm: Number(values.levelMm),
    waterLevelMm: Number(values.waterLevelMm),
    temperatureC: temperature.length === 0 ? null : Number(temperature),
    source: 'manual',
    idempotencyKey,
  };
}

export { FUEL_PRODUCTS, DEVICE_PROTOCOLS };
