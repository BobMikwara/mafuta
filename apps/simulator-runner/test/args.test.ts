import { describe, expect, it } from 'vitest';
import { ArgumentError, parseArgs } from '../src/args.js';

const BASE = [
  '--api-url',
  'http://localhost:3000',
  '--api-key',
  'dev-key-1234567890',
  '--tank-id',
  'tank-1',
];

describe('simulator argument parsing', () => {
  it('parses the required arguments with defaults', () => {
    const config = parseArgs(BASE);
    expect(config.apiUrl).toBe('http://localhost:3000');
    expect(config.tankIds).toEqual(['tank-1']);
    expect(config.intervalSeconds).toBe(30);
    expect(config.dtMinutes).toBe(1);
    expect(config.scenario).toBe('nominal');
    expect(config.seed).toBe('fueltrack-ea');
    expect(config.maxSteps).toBeNull();
  });

  it('accepts several tanks and optional flags', () => {
    const config = parseArgs([
      ...BASE,
      '--tank-id',
      'tank-2',
      '--interval-seconds',
      '5',
      '--dt-minutes',
      '15',
      '--scenario',
      'theft',
      '--seed',
      'abc',
      '--max-steps',
      '3',
      '--latency-ms',
      '10',
      '--failure-rate',
      '0.5',
    ]);
    expect(config.tankIds).toEqual(['tank-1', 'tank-2']);
    expect(config.intervalSeconds).toBe(5);
    expect(config.dtMinutes).toBe(15);
    expect(config.scenario).toBe('theft');
    expect(config.seed).toBe('abc');
    expect(config.maxSteps).toBe(3);
    expect(config.latencyMs).toBe(10);
    expect(config.failureRate).toBe(0.5);
  });

  it('strips a trailing slash from the api url', () => {
    expect(
      parseArgs([
        '--api-url',
        'http://localhost:3000/',
        '--api-key',
        'k'.repeat(16),
        '--tank-id',
        'tank-1',
      ]).apiUrl,
    ).toBe('http://localhost:3000');
  });

  it('rejects missing required arguments', () => {
    expect(() => parseArgs([])).toThrow(ArgumentError);
    expect(() => parseArgs(['--api-key', 'k'.repeat(16), '--tank-id', 'tank-1'])).toThrow(
      ArgumentError,
    );
    expect(() => parseArgs(['--api-url', 'http://localhost:3000', '--tank-id', 'tank-1'])).toThrow(
      ArgumentError,
    );
    expect(() =>
      parseArgs(['--api-url', 'http://localhost:3000', '--api-key', 'k'.repeat(16)]),
    ).toThrow(ArgumentError);
  });

  it('rejects a missing value for a flag', () => {
    expect(() => parseArgs([...BASE, '--scenario'])).toThrow(ArgumentError);
  });

  it('rejects a non http url', () => {
    expect(() =>
      parseArgs([
        '--api-url',
        'ftp://example.com',
        '--api-key',
        'k'.repeat(16),
        '--tank-id',
        'tank-1',
      ]),
    ).toThrow(ArgumentError);
    expect(() =>
      parseArgs(['--api-url', 'not a url', '--api-key', 'k'.repeat(16), '--tank-id', 'tank-1']),
    ).toThrow(ArgumentError);
  });

  it('rejects out of range numbers', () => {
    expect(() => parseArgs([...BASE, '--interval-seconds', '0'])).toThrow(ArgumentError);
    expect(() => parseArgs([...BASE, '--interval-seconds', '99999'])).toThrow(ArgumentError);
    expect(() => parseArgs([...BASE, '--dt-minutes', '0'])).toThrow(ArgumentError);
    expect(() => parseArgs([...BASE, '--failure-rate', '2'])).toThrow(ArgumentError);
  });

  it('rejects an unknown scenario, argument or tank id', () => {
    expect(() => parseArgs([...BASE, '--scenario', 'explode'])).toThrow(ArgumentError);
    expect(() => parseArgs([...BASE, '--unknown'])).toThrow(ArgumentError);
    expect(() =>
      parseArgs([
        '--api-url',
        'http://localhost:3000',
        '--api-key',
        'k'.repeat(16),
        '--tank-id',
        'BAD ID',
      ]),
    ).toThrow(ArgumentError);
  });

  it('prints usage for the help flag', () => {
    try {
      parseArgs(['--help']);
      throw new Error('expected help to raise');
    } catch (error) {
      expect(error).toBeInstanceOf(ArgumentError);
      expect((error as ArgumentError).message).toContain('Usage: fueltrack-simulator');
      expect((error as ArgumentError).message).toContain('simulated');
    }
  });
});
