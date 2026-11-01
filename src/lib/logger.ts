export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

export type LogSink = (entry: LogEntry, serialized: string) => void;

const SENSITIVE_KEY_PATTERNS = [
  /key/i,
  /token/i,
  /secret/i,
  /password/i,
  /auth/i,
  /credential/i,
  /cookie/i,
  /authorization/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactSensitiveData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Redact bearer tokens or secrets embedded in strings
    return value.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
  }
  if (typeof value !== "object") return value;

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSensitiveKey(k)) {
      result[k] = "[REDACTED]";
    } else {
      result[k] = redactSensitiveData(v, seen);
    }
  }
  return result;
}

function defaultSink(entry: LogEntry, serialized: string): void {
  if (entry.level === "error") {
    console.error(serialized);
  } else if (entry.level === "warn") {
    console.warn(serialized);
  } else if (entry.level === "info") {
    console.info(serialized);
  } else {
    console.debug(serialized);
  }
}

export class Logger {
  constructor(
    private readonly defaultContext: Record<string, unknown> = {},
    private sink: LogSink = defaultSink,
  ) {}

  setSink(sink: LogSink): void {
    this.sink = sink;
  }

  child(context: Record<string, unknown>): Logger {
    return new Logger({ ...this.defaultContext, ...context }, this.sink);
  }

  private emit(level: LogLevel, message: string, context?: Record<string, unknown>, err?: unknown): void {
    const errorDetails = err instanceof Error
      ? {
          name: err.name,
          message: err.message,
          stack: err.stack,
          code: (err as { code?: string }).code,
        }
      : typeof err === "string"
        ? { message: err }
        : undefined;

    const combinedContext = {
      ...this.defaultContext,
      ...context,
    };

    const sanitizedContext = redactSensitiveData(combinedContext) as Record<string, unknown>;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(Object.keys(sanitizedContext).length > 0 ? { context: sanitizedContext } : {}),
      ...(errorDetails ? { error: errorDetails } : {}),
    };

    const serialized = JSON.stringify(entry);
    this.sink(entry, serialized);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.emit("warn", message, context, error);
  }

  error(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.emit("error", message, context, error);
  }
}

export const logger = new Logger();
