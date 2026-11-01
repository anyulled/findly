import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginSessionRequest, isOwnerEmailAuthorized } from "../src/lib/sync-request-auth";

test("accepts a same-origin browser sync request", () => {
  const request = new Request("https://findly.example/api/cron/sync", { method: "POST", headers: { origin: "https://findly.example" } });
  assert.equal(isSameOriginSessionRequest(request), true);
});

test("rejects missing, invalid, and cross-origin request origins", () => {
  assert.equal(isSameOriginSessionRequest(new Request("https://findly.example/api/cron/sync", { method: "POST" })), false);
  assert.equal(isSameOriginSessionRequest(new Request("https://findly.example/api/cron/sync", { method: "POST", headers: { origin: "not a URL" } })), false);
  assert.equal(isSameOriginSessionRequest(new Request("https://findly.example/api/cron/sync", { method: "POST", headers: { origin: "https://attacker.example" } })), false);
});

test("isOwnerEmailAuthorized validates matching email case-insensitively", () => {
  assert.equal(isOwnerEmailAuthorized("Owner@Example.COM", "owner@example.com"), true);
  assert.equal(isOwnerEmailAuthorized("other@example.com", "owner@example.com"), false);
  assert.equal(isOwnerEmailAuthorized(null, "owner@example.com"), false);
  assert.equal(isOwnerEmailAuthorized("owner@example.com", undefined), false);
});

