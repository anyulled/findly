import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { updateSession } from "../src/lib/supabase/proxy";

test("the public landing does not contact Supabase even when a provider is configured", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unreachable.example.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "mock-publishable-key";
  globalThis.fetch = async () => { throw new Error("The public landing must not contact Supabase"); };
  try {
    const response = await updateSession(new NextRequest("https://findly.example/"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});


test("the workspace remains protected in production without Supabase configuration", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    const response = await updateSession(new NextRequest("https://findly.example/workspace"));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://findly.example/login?error=setup");
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: previousNodeEnv });
  }
});


test("an OAuth code arriving at the public landing is forwarded to the callback", async () => {
  const response = await updateSession(new NextRequest("https://findly.example/?code=example-code&state=example-state"));
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.pathname, "/auth/callback");
  assert.equal(location.searchParams.get("code"), "example-code");
  assert.equal(location.searchParams.get("state"), "example-state");
});
