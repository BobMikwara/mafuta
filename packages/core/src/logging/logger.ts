/**
 * Structured logging. `console.log` is banned across the codebase, so every
 * diagnostic path goes through a Logger built on top of a swappable sink.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export type LogContext = Readonly<Record<string, unknown>>;

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly context: LogContext;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  critical(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  critical: 50,
};

export interface LoggerOptions {
  readonly sink: LogSink;
  readonly minLevel?: LogLevel;
  readonly bindings?: LogContext;
  readonly now?: () => Date;
}

export function createLogger(options: LoggerOptions): Logger {
  const minWeight = LEVEL_WEIGHT[options.minLevel ?? 'info'];
  const bindings = options.bindings ?? {};
  const now = options.now ?? (() => new Date());

  const emit = (level: LogLevel, message: string, context: LogContext): void => {
    if (LEVEL_WEIGHT[level] < minWeight) {
      return;
    }
    try {
      options.sink({
        level,
        message,
        timestamp: now().toISOString(),
        context: { ...bindings, ...context },
      });
    } catch {
      // A broken sink must never take down a request or an ingest cycle.
    }
  };

  const logger: Logger = {
    debug: (message, context = {}) => emit('debug', message, context),
    info: (message, context = {}) => emit('info', message, context),
    warn: (message, context = {}) => emit('warn', message, context),
    error: (message, context = {}) => emit('error', message, context),
    critical: (message, context = {}) => emit('critical', message, context),
    child: (extra) =>
      createLogger({
        sink: options.sink,
        ...(options.minLevel === undefined ? {} : { minLevel: options.minLevel }),
        bindings: { ...bindings, ...extra },
        now,
      }),
  };

  return logger;
}

export interface MemoryLogSink extends LogSink {
  records: ReadonlyArray<LogRecord>;
  clear(): void;
  recordsAtOrAbove(level: LogLevel): ReadonlyArray<LogRecord>;
}

export function createMemoryLogSink(): MemoryLogSink {
  const records: LogRecord[] = [];
  const sink = ((record: LogRecord): void => {
    records.push(record);
  }) as MemoryLogSink;

  sink.records = records;
  sink.clear = (): void => {
    records.length = 0;
  };
  sink.recordsAtOrAbove = (level: LogLevel): ReadonlyArray<LogRecord> =>
    records.filter((record) => LEVEL_WEIGHT[record.level] >= LEVEL_WEIGHT[level]);

  return sink;
}

/** Writes newline delimited JSON to stdout/stdout pipes without using console. */
export function createStdioSink(options?: {
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
}): LogSink {
  const stdout = options?.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const stderr = options?.stderr ?? ((chunk: string) => process.stderr.write(chunk));

  return (record: LogRecord): void => {
    const line = `${JSON.stringify(record)}\n`;
    if (LEVEL_WEIGHT[record.level] >= LEVEL_WEIGHT['error']) {
      stderr(line);
    } else {
      stdout(line);
    }
  };
}

export function createSilentLogger(): Logger {
  return createLogger({ sink: createMemoryLogSink(), minLevel: 'critical' });
}
