import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countPostCharacters, validatePost } from "../src/lib/social-validation";

describe("social post validation", () => {
  it("uses the X URL weight instead of the raw URL length", () => {
    assert.equal(countPostCharacters("X", "See https://example.com/a-long-link"), 27);
  });

  it("counts Bluesky grapheme clusters", () => {
    assert.equal(countPostCharacters("Bluesky", "e\u0301👩‍💻"), 2);
  });

  it("rejects text over the network limit", () => {
    const result = validatePost("X", "x".repeat(281));
    assert.deepEqual(result, { valid: false, count: 281, limit: 280, message: "Supera el límite de X por 1 caracteres." });
  });
});
