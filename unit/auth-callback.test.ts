import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveOAuthCallbackLocation,
  resolveOAuthRedirect,
} from "@/lib/auth-callback";

const origin = "https://findly.example";

test("resolveOAuthRedirect preserves local paths and query strings", () => {
  assert.equal(
    resolveOAuthRedirect("/workspace/events?view=week", origin).href,
    "https://findly.example/workspace/events?view=week",
  );
});

test("resolveOAuthRedirect falls back for missing and non-path destinations", () => {
  assert.equal(resolveOAuthRedirect(null, origin).href, `${origin}/`);
  assert.equal(resolveOAuthRedirect("dashboard", origin).href, `${origin}/`);
});

test("resolveOAuthRedirect rejects external, protocol-relative, and backslash destinations", () => {
  for (const next of [
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "/%5C%5Cattacker.example/path",
  ]) {
    assert.equal(resolveOAuthRedirect(next, origin).href, `${origin}/`, next);
  }

  const encodedQuery = new URLSearchParams("next=%2F%5Cexample.invalid%2Fpath");
  assert.equal(resolveOAuthRedirect(encodedQuery.get("next"), origin).href, `${origin}/`);
});

test("resolveOAuthRedirect rejects credentials even when the host matches", () => {
  assert.equal(
    resolveOAuthRedirect("https://user:password@findly.example/workspace", origin).href,
    `${origin}/`,
  );
});

test("resolveOAuthCallbackLocation returns the local destination after a successful exchange", async () => {
  let receivedCode: string | undefined;
  const result = await resolveOAuthCallbackLocation(
    "oauth-code",
    "/workspace?tab=events",
    origin,
    async (code) => {
      receivedCode = code;
      return true;
    },
  );

  assert.equal(receivedCode, "oauth-code");
  assert.equal(result.authenticated, true);
  assert.equal(result.location.href, `${origin}/workspace?tab=events`);
});

test("resolveOAuthCallbackLocation sends a successful callback without next to the workspace", async () => {
  const result = await resolveOAuthCallbackLocation("oauth-code", null, origin, async () => true);

  assert.equal(result.authenticated, true);
  assert.equal(result.location.href, `${origin}/workspace`);
});

test("resolveOAuthCallbackLocation falls back locally after a successful exchange with an external next", async () => {
  const result = await resolveOAuthCallbackLocation(
    "oauth-code",
    "https://attacker.example/path",
    origin,
    async () => true,
  );

  assert.equal(result.authenticated, true);
  assert.equal(result.location.href, `${origin}/`);
});

test("resolveOAuthCallbackLocation rejects the redirect after a failed exchange", async () => {
  const result = await resolveOAuthCallbackLocation(
    "oauth-code",
    "/workspace",
    origin,
    async () => false,
  );

  assert.equal(result.authenticated, false);
  assert.equal(result.location.href, `${origin}/login?error=auth`);
});

test("resolveOAuthCallbackLocation does not exchange a missing code", async () => {
  let exchanged = false;
  const result = await resolveOAuthCallbackLocation(null, "/workspace", origin, async () => {
    exchanged = true;
    return true;
  });

  assert.equal(exchanged, false);
  assert.equal(result.authenticated, false);
  assert.equal(result.location.href, `${origin}/login?error=auth`);
});
