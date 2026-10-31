import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectTitleLanguage } from "../src/lib/language";

describe("title language detection", () => {
  it("detects Spanish and Catalan title cues", () => {
    assert.equal(detectTitleLanguage("Próxima reunión de la comunidad"), "es");
    assert.equal(detectTitleLanguage("Trobada de la comunitat de programació"), "ca");
  });

  it("defaults uncertain titles to English", () => {
    assert.equal(detectTitleLanguage("AI Builders: From idea to product"), "en");
    assert.equal(detectTitleLanguage("Meetup BCN 2026"), "en");
  });
});
