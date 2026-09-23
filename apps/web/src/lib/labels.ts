export const FUEL_PRODUCTS = ['diesel', 'petrol-91', 'petrol-95', 'kerosene', 'adblue'] as const;
export type FuelProduct = (typeof FUEL_PRODUCTS)[number];

export const PRODUCT_LABELS: Record<FuelProduct, string> = {
  diesel: 'Diesel',
  'petrol-91': 'Petrol 91',
  'petrol-95': 'Petrol 95',
  kerosene: 'Kerosene',
  adblue: 'AdBlue',
};

export const STATION_TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Africa/Dar_es_Salaam', label: 'Dar es Salaam, Tanzania' },
  { value: 'Africa/Nairobi', label: 'Nairobi, Kenya' },
  { value: 'Africa/Kampala', label: 'Kampala, Uganda' },
  { value: 'Africa/Kigali', label: 'Kigali, Rwanda' },
  { value: 'Africa/Bujumbura', label: 'Bujumbura, Burundi' },
  { value: 'Africa/Addis_Ababa', label: 'Addis Ababa, Ethiopia' },
  { value: 'Africa/Lusaka', label: 'Lusaka, Zambia' },
  { value: 'Africa/Maputo', label: 'Maputo, Mozambique' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg, South Africa' },
  { value: 'UTC', label: 'UTC' },
];

export const DEFAULT_STATION_TIMEZONE = 'Africa/Dar_es_Salaam';

export const ALERT_LABELS: Record<string, string> = {
  low_stock: 'Low stock',
  critical_stock: 'Critical stock',
  device_offline: 'Device offline',
  stale_data: 'Stale data',
  probe_quality: 'Probe quality',
  candidate_delivery: 'Candidate delivery',
  candidate_unexplained_decrease: 'Unexplained decrease',
  water_level: 'Water level',
};

export const EVENT_LABELS: Record<string, string> = {
  candidate_delivery: 'Candidate delivery',
  candidate_unexplained_decrease: 'Unexplained decrease',
};

export const PROTOCOL_LABELS: Record<string, string> = {
  simulated: 'Simulated',
  http: 'HTTP',
  mqtt: 'MQTT',
  modbus_rtu: 'Modbus RTU',
  modbus_tcp: 'Modbus TCP',
  other: 'Other',
};

export function productLabel(product: string): string {
  if (isFuelProduct(product)) {
    return PRODUCT_LABELS[product];
  }
  return product;
}

export function isFuelProduct(value: string): value is FuelProduct {
  return (FUEL_PRODUCTS as ReadonlyArray<string>).includes(value);
}

export function alertLabel(type: string): string {
  return ALERT_LABELS[type] ?? type.replaceAll('_', ' ');
}

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replaceAll('_', ' ');
}

export function protocolLabel(protocol: string): string {
  return PROTOCOL_LABELS[protocol] ?? protocol;
}

export function freshnessLabel(freshness: string | null | undefined): string {
  if (freshness === 'fresh') return 'Fresh';
  if (freshness === 'delayed') return 'Delayed';
  if (freshness === 'stale') return 'Stale';
  return 'No reading';
}

export function sourceLabel(source: string | null | undefined): string {
  if (source === 'simulated') return 'Simulated';
  if (source === 'device') return 'Device';
  if (source === 'manual') return 'Manual dip';
  return 'Unknown source';
}

export function qualityLabel(quality: string | null | undefined): string {
  if (quality === 'ok') return 'OK';
  if (quality === 'suspect') return 'Suspect';
  if (quality === 'invalid') return 'Invalid';
  return 'Unknown';
}
