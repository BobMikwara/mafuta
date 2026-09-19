import { describe, expect, it } from 'vitest';
import {
  createLogger,
  createMemoryLogSink,
  createSilentLogger,
  createStdioSink,
} from '../src/logging/logger.js';

describe('logger', () => {
  it('emits structured records with bindings', () => {
    const sink = createMemoryLogSink();
    const logger = createLogger({ sink, bindings: { service: 'core' } });
    logger.info('tank.created', { tankId: 'tank-1' });

    const record = sink.records[0];
    expect(record?.message).toBe('tank.created');
    expect(record?.level).toBe('info');
    expect(record?.context).toEqual({ service: 'core', tankId: 'tank-1' });
    expect(record?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('honours the minimum level', () => {
    const sink = createMemoryLogSink();
    const logger = createLogger({ sink, minLevel: 'warn' });
    logger.debug('ignored');
    logger.info('ignored');
    logger.warn('kept');
    logger.error('kept');
    logger.critical('kept');

    expect(sink.records.map((record) => record.level)).toEqual(['warn', 'error', 'critical']);
    expect(sink.recordsAtOrAbove('error')).toHaveLength(2);
  });

  it('merges child bindings without mutating the parent', () => {
    const sink = createMemoryLogSink();
    const parent = createLogger({ sink, bindings: { service: 'core' } });
    const child = parent.child({ tenantId: 'tenant-a' });

    child.info('reading.ingested');
    parent.info('reading.ingested');

    expect(sink.records[0]?.context).toEqual({ service: 'core', tenantId: 'tenant-a' });
    expect(sink.records[1]?.context).toEqual({ service: 'core' });
  });

  it('never throws when the sink fails', () => {
    const logger = createLogger({
      sink: () => {
        throw new Error('sink is down');
      },
    });
    expect(() => logger.error('boom', { detail: 'x' })).not.toThrow();
  });

  it('writes to stderr only for error and critical levels', () => {
    const out: string[] = [];
    const err: string[] = [];
    const logger = createLogger({
      sink: createStdioSink({
        stdout: (chunk) => out.push(chunk),
        stderr: (chunk) => err.push(chunk),
      }),
    });

    logger.info('hello');
    logger.error('bad');

    expect(out).toHaveLength(1);
    expect(err).toHaveLength(1);
    expect(JSON.parse(err[0] ?? '{}').level).toBe('error');
  });

  it('provides a silent logger for tests', () => {
    const logger = createSilentLogger();
    logger.info('noise');
    logger.error('noise');
    expect(true).toBe(true);
  });
});
