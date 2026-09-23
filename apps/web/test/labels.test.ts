import { describe, expect, it } from 'vitest';
import {
  alertLabel,
  eventLabel,
  freshnessLabel,
  isFuelProduct,
  productLabel,
  protocolLabel,
  qualityLabel,
  sourceLabel,
} from '../src/lib/labels.js';

describe('labels', () => {
  it('names known products and leaves unknown ones unchanged', () => {
    expect(isFuelProduct('diesel')).toBe(true);
    expect(isFuelProduct('water')).toBe(false);
    expect(productLabel('petrol-95')).toBe('Petrol 95');
    expect(productLabel('other')).toBe('other');
  });

  it('names alerts, events, protocols, freshness, source and quality', () => {
    expect(alertLabel('stale_data')).toBe('Stale data');
    expect(alertLabel('custom_type')).toBe('custom type');
    expect(eventLabel('candidate_delivery')).toBe('Candidate delivery');
    expect(eventLabel('other_event')).toBe('other event');
    expect(protocolLabel('modbus_tcp')).toBe('Modbus TCP');
    expect(protocolLabel('vendor')).toBe('vendor');
    expect(freshnessLabel('fresh')).toBe('Fresh');
    expect(freshnessLabel('delayed')).toBe('Delayed');
    expect(freshnessLabel('stale')).toBe('Stale');
    expect(freshnessLabel(null)).toBe('No reading');
    expect(sourceLabel('simulated')).toBe('Simulated');
    expect(sourceLabel('device')).toBe('Device');
    expect(sourceLabel('manual')).toBe('Manual dip');
    expect(sourceLabel('')).toBe('Unknown source');
    expect(qualityLabel('ok')).toBe('OK');
    expect(qualityLabel('suspect')).toBe('Suspect');
    expect(qualityLabel('invalid')).toBe('Invalid');
    expect(qualityLabel(undefined)).toBe('Unknown');
  });
});
