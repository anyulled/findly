import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAction, runVoidAction, UserFacingError } from "../src/lib/action-result";
import { logger, type LogEntry } from "../src/lib/logger";

describe("action-result", () => {
  it("returns success with data when action succeeds", async () => {
    const result = await runAction("testSuccess", async () => ({ id: "123", value: "hello" }));
    assert.deepEqual(result, { success: true, data: { id: "123", value: "hello" } });
  });

  it("returns safe user-facing message and logs warn when UserFacingError is thrown", async () => {
    const entries: LogEntry[] = [];
    logger.setSink((entry) => entries.push(entry));

    const result = await runAction("testValidation", async () => {
      throw new UserFacingError("El título es obligatorio.");
    });

    assert.deepEqual(result, { success: false, error: "El título es obligatorio." });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].level, "warn");
    assert.match(entries[0].message, /testValidation/);
    assert.equal(entries[0].error?.message, "El título es obligatorio.");
  });

  it("masks internal errors and logs error when generic error is thrown", async () => {
    const entries: LogEntry[] = [];
    logger.setSink((entry) => entries.push(entry));

    const result = await runAction("testInternalError", async () => {
      throw new Error("PGRST301: JWT expired or connection refused at 10.0.0.1:5432");
    }, { defaultErrorMessage: "No se pudo completar la operación." });

    assert.deepEqual(result, { success: false, error: "No se pudo completar la operación." });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].level, "error");
    assert.match(entries[0].message, /testInternalError/);
    assert.match(entries[0].error?.message ?? "", /PGRST301/);
  });

  it("handles runVoidAction for operations returning void", async () => {
    const successResult = await runVoidAction("testVoidSuccess", async () => {});
    assert.deepEqual(successResult, { success: true });

    const failResult = await runVoidAction("testVoidFail", async () => {
      throw new UserFacingError("No se pudo eliminar.");
    });
    assert.deepEqual(failResult, { success: false, error: "No se pudo eliminar." });
  });
});
