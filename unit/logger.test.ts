import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Logger, redactSensitiveData, type LogEntry } from "../src/lib/logger";

describe("logger", () => {
  it("redacts sensitive keys and bearer tokens", () => {
    const raw = {
      apiKey: "super-secret-key",
      userToken: "my-jwt-token",
      passwordHash: "hash123",
      authorizationHeader: "Bearer eyJhbGciOi...",
      auth_secret: "123",
      nested: {
        normalField: "hello",
        client_secret: "hidden",
      },
      list: [
        { sessionToken: "abc" },
        "Bearer some-raw-token",
      ],
    };

    const redacted = redactSensitiveData(raw) as Record<string, unknown>;
    assert.equal(redacted.apiKey, "[REDACTED]");
    assert.equal(redacted.userToken, "[REDACTED]");
    assert.equal(redacted.passwordHash, "[REDACTED]");
    assert.equal(redacted.authorizationHeader, "[REDACTED]");
    assert.equal(redacted.auth_secret, "[REDACTED]");
    assert.deepEqual(redacted.nested, { normalField: "hello", client_secret: "[REDACTED]" });
    assert.deepEqual((redacted.list as unknown[])[0], { sessionToken: "[REDACTED]" });
    assert.equal((redacted.list as unknown[])[1], "Bearer [REDACTED]");
  });

  it("handles circular references gracefully", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;

    const redacted = redactSensitiveData(circular) as Record<string, unknown>;
    assert.equal(redacted.name, "root");
    assert.equal(redacted.self, "[Circular]");
  });

  it("handles primitives, null, and undefined", () => {
    assert.equal(redactSensitiveData(null), null);
    assert.equal(redactSensitiveData(undefined), undefined);
    assert.equal(redactSensitiveData(123), 123);
    assert.equal(redactSensitiveData(true), true);
  });

  it("emits structured logs with level, timestamp, message, context, and error", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({ service: "test-service" }, (entry) => entries.push(entry));

    logger.debug("debug message", { extra: 1 });
    logger.info("info message");
    logger.warn("warn message", { op: "sync" }, new Error("something warned"));
    logger.error("error message", { target: "buffer" }, new Error("fatal issue"));
    logger.error("error with string", undefined, "string error");

    assert.equal(entries.length, 5);

    assert.equal(entries[0].level, "debug");
    assert.equal(entries[0].message, "debug message");
    assert.deepEqual(entries[0].context, { service: "test-service", extra: 1 });

    assert.equal(entries[1].level, "info");
    assert.equal(entries[1].message, "info message");

    assert.equal(entries[2].level, "warn");
    assert.equal(entries[2].error?.message, "something warned");

    assert.equal(entries[3].level, "error");
    assert.equal(entries[3].error?.message, "fatal issue");

    assert.equal(entries[4].level, "error");
    assert.equal(entries[4].error?.message, "string error");
  });

  it("creates child loggers with merged default context", () => {
    const entries: LogEntry[] = [];
    const baseLogger = new Logger({ environment: "test" }, (entry) => entries.push(entry));
    const child = baseLogger.child({ module: "sync" });

    child.info("sync started", { items: 5 });

    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].context, {
      environment: "test",
      module: "sync",
      items: 5,
    });
  });

  it("uses default console sinks when none is provided", () => {
    const originalInfo = console.info;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalDebug = console.debug;

    const logged: string[] = [];
    console.info = (msg: unknown) => logged.push(`info:${String(msg)}`);
    console.error = (msg: unknown) => logged.push(`error:${String(msg)}`);
    console.warn = (msg: unknown) => logged.push(`warn:${String(msg)}`);
    console.debug = (msg: unknown) => logged.push(`debug:${String(msg)}`);

    try {
      const defaultLogger = new Logger();
      defaultLogger.info("test info");
      defaultLogger.error("test error");
      defaultLogger.warn("test warn");
      defaultLogger.debug("test debug");

      assert.equal(logged.length, 4);
      assert.match(logged[0], /info:\{.*"message":"test info"/);
      assert.match(logged[1], /error:\{.*"message":"test error"/);
      assert.match(logged[2], /warn:\{.*"message":"test warn"/);
      assert.match(logged[3], /debug:\{.*"message":"test debug"/);
    } finally {
      console.info = originalInfo;
      console.error = originalError;
      console.warn = originalWarn;
      console.debug = originalDebug;
    }
  });
});
