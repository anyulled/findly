import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeClientErrorMessage } from "../src/lib/client-error";

describe("sanitizeClientErrorMessage", () => {
  it("returns fallback message when error is null, undefined, or empty", () => {
    assert.equal(sanitizeClientErrorMessage(null, "Default fallback"), "Default fallback");
    assert.equal(sanitizeClientErrorMessage(undefined, "Default fallback"), "Default fallback");
    assert.equal(sanitizeClientErrorMessage(new Error(""), "Default fallback"), "Default fallback");
    assert.equal(sanitizeClientErrorMessage("   ", "Default fallback"), "Default fallback");
  });

  it("sanitizes Minified React error messages into user-friendly Spanish", () => {
    const error = new Error("Minified React error #441; visit https://react.dev/errors/441 for the full message");
    const result = sanitizeClientErrorMessage(error, "Fallback");
    assert.equal(result, "El servidor no pudo procesar la solicitud en este momento. Por favor, inténtalo de nuevo.");
  });

  it("sanitizes network failures into user-friendly connectivity messages", () => {
    assert.equal(
      sanitizeClientErrorMessage(new Error("TypeError: Failed to fetch"), "Fallback"),
      "Error de conexión con el servidor. Comprueba tu conexión a internet e inténtalo de nuevo.",
    );
    assert.equal(
      sanitizeClientErrorMessage("NetworkError when attempting to fetch resource", "Fallback"),
      "Error de conexión con el servidor. Comprueba tu conexión a internet e inténtalo de nuevo.",
    );
  });

  it("sanitizes Server Components render error text", () => {
    const error = new Error("An error occurred in the Server Components render. The specific message is omitted");
    const result = sanitizeClientErrorMessage(error, "Fallback");
    assert.equal(result, "Ha ocurrido un error inesperado en el servidor. Por favor, inténtalo de nuevo más tarde.");
  });

  it("preserves safe, ordinary error messages without modification", () => {
    const error = new Error("Completa título, fecha y hora del evento.");
    const result = sanitizeClientErrorMessage(error, "Fallback");
    assert.equal(result, "Completa título, fecha y hora del evento.");
  });
});
