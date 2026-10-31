import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

test("updateSession redirects requests with code to /auth/callback", async () => {
  const req = new NextRequest("https://findly-anyulleds-projects.vercel.app/login?code=test-code-123&next=%2F");
  const res = await updateSession(req);
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "https://findly-anyulleds-projects.vercel.app/auth/callback?code=test-code-123&next=%2F");
});

test("updateSession redirects requests arriving at root with code to /auth/callback", async () => {
  const req = new NextRequest("https://findly-anyulleds-projects.vercel.app/?code=sample-auth-code");
  const res = await updateSession(req);
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "https://findly-anyulleds-projects.vercel.app/auth/callback?code=sample-auth-code");
});
