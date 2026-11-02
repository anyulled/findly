import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNotification,
  classifyPublishOutcome,
} from "../src/lib/notifications";

describe("notifications business logic", () => {
  it("classifies scheduled outcome as success with green indicator", () => {
    const result = classifyPublishOutcome({ kind: "scheduled" });
    assert.equal(result.type, "success");
    assert.equal(result.message, "Publicación aprobada y programada en Buffer.");
  });

  it("classifies needs_reconciliation outcome as warning with yellow indicator", () => {
    const result = classifyPublishOutcome({ kind: "needs_reconciliation" });
    assert.equal(result.type, "warning");
    assert.match(result.message, /Buffer pudo aceptar la publicación/);
  });

  it("classifies failed outcome with custom message as error with red indicator", () => {
    const result = classifyPublishOutcome({
      kind: "failed",
      message: "Canal desconectado",
    });
    assert.equal(result.type, "error");
    assert.equal(
      result.message,
      "La publicación se aprobó, pero Buffer la rechazó: Canal desconectado",
    );
  });

  it("classifies failed outcome without message with fallback text", () => {
    const result = classifyPublishOutcome({
      kind: "failed",
      message: null,
    });
    assert.equal(result.type, "error");
    assert.equal(
      result.message,
      "La publicación se aprobó, pero Buffer la rechazó: comprueba la configuración",
    );
  });

  it("classifies not_claimed outcome as warning", () => {
    const result = classifyPublishOutcome({ kind: "not_claimed" });
    assert.equal(result.type, "warning");
    assert.match(result.message, /No se pudo reservar la publicación/);
  });

  it("classifies generic error outcome as error", () => {
    const result = classifyPublishOutcome({
      kind: "error",
      message: "Fallo de conexión",
    });
    assert.equal(result.type, "error");
    assert.equal(result.message, "Fallo de conexión");
  });

  it("classifies empty error outcome with fallback message", () => {
    const result = classifyPublishOutcome({
      kind: "error",
      message: "",
    });
    assert.equal(result.type, "error");
    assert.equal(result.message, "Error al procesar la publicación.");
  });

  it("classifies other unknown kinds as in-flight info", () => {
    const result = classifyPublishOutcome({ kind: "in_flight" });
    assert.equal(result.type, "info");
    assert.equal(result.message, "La publicación está en proceso de envío.");
  });

  it("builds a complete notification item with defaults", () => {
    const item = buildNotification("Operación realizada", "success");
    assert.equal(item.message, "Operación realizada");
    assert.equal(item.type, "success");
    assert.equal(item.timeout, 5000);
    assert.equal(item.action, undefined);
  });

  it("builds a notification item with custom action and timeout", () => {
    let clicked = false;
    const action = {
      label: "Ver detalle",
      href: "/workspace#post-1",
      onClick: () => {
        clicked = true;
      },
    };
    const item = buildNotification("Atención requerida", "warning", action, 8000);
    assert.equal(item.message, "Atención requerida");
    assert.equal(item.type, "warning");
    assert.equal(item.timeout, 8000);
    assert.equal(item.action?.label, "Ver detalle");
    assert.equal(item.action?.href, "/workspace#post-1");
    item.action?.onClick?.();
    assert.equal(clicked, true);
  });
});
