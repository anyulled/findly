import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmAsync } from "../src/lib/confirm-dialog";

describe("confirmAsync", () => {
  it("resolves to true when the confirm function returns true", async () => {
    let receivedMessage = "";
    const result = await confirmAsync("¿Eliminar?", (msg) => {
      receivedMessage = msg;
      return true;
    });

    assert.equal(result, true);
    assert.equal(receivedMessage, "¿Eliminar?");
  });

  it("resolves to false when the confirm function returns false", async () => {
    let receivedMessage = "";
    const result = await confirmAsync("¿Continuar?", (msg) => {
      receivedMessage = msg;
      return false;
    });

    assert.equal(result, false);
    assert.equal(receivedMessage, "¿Continuar?");
  });

  it("resolves to false when the confirm function throws", async () => {
    const result = await confirmAsync("¿Eliminar?", () => {
      throw new Error("Dialog error");
    });

    assert.equal(result, false);
  });

  it("uses window.confirm if available in global environment", async () => {
    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    try {
      let promptMessage = "";
      (globalThis as unknown as { window: { confirm: (msg: string) => boolean } }).window = {
        confirm: (msg: string) => {
          promptMessage = msg;
          return true;
        },
      };

      const result = await confirmAsync("¿Seguro de eliminar?");
      assert.equal(result, true);
      assert.equal(promptMessage, "¿Seguro de eliminar?");
    } finally {
      if (originalWindow !== undefined) {
        (globalThis as unknown as { window: unknown }).window = originalWindow;
      } else {
        delete (globalThis as unknown as { window?: unknown }).window;
      }
    }
  });

  it("defaults to false when window is undefined in SSR/Node environment", async () => {
    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    try {
      delete (globalThis as unknown as { window?: unknown }).window;
      const result = await confirmAsync("¿Confirmar en servidor?");
      assert.equal(result, false);
    } finally {
      if (originalWindow !== undefined) {
        (globalThis as unknown as { window: unknown }).window = originalWindow;
      }
    }
  });
});
