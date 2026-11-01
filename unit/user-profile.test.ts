import assert from "node:assert/strict";
import test from "node:test";
import { extractUserProfile } from "../src/lib/user-profile";

test("extractUserProfile returns default administrator profile for null/undefined user", () => {
  assert.deepEqual(extractUserProfile(null), {
    name: "Administrador",
    email: "",
    avatarUrl: undefined,
    initials: "A",
  });
  assert.deepEqual(extractUserProfile(undefined), {
    name: "Administrador",
    email: "",
    avatarUrl: undefined,
    initials: "A",
  });
});

test("extractUserProfile prefers full_name from OAuth user_metadata", () => {
  const profile = extractUserProfile({
    email: "anyulled@example.com",
    user_metadata: {
      full_name: "Anyul Rivas",
      avatar_url: "https://lh3.googleusercontent.com/a/photo.jpg",
    },
  });
  assert.equal(profile.name, "Anyul Rivas");
  assert.equal(profile.email, "anyulled@example.com");
  assert.equal(profile.avatarUrl, "https://lh3.googleusercontent.com/a/photo.jpg");
  assert.equal(profile.initials, "AR");
});

test("extractUserProfile supports picture and name fallbacks", () => {
  const profile = extractUserProfile({
    email: "carol@example.com",
    user_metadata: {
      name: "Carol",
      picture: "https://example.com/avatar.png",
    },
  });
  assert.equal(profile.name, "Carol");
  assert.equal(profile.avatarUrl, "https://example.com/avatar.png");
  assert.equal(profile.initials, "C");
});

test("extractUserProfile falls back to user_name and email prefix", () => {
  const fromUserName = extractUserProfile({
    email: "dev@example.com",
    user_metadata: { user_name: "johndoe" },
  });
  assert.equal(fromUserName.name, "johndoe");
  assert.equal(fromUserName.initials, "J");

  const fromEmail = extractUserProfile({
    email: "alexander.great@example.com",
    user_metadata: {},
  });
  assert.equal(fromEmail.name, "alexander.great");
  assert.equal(fromEmail.initials, "A");
});

test("extractUserProfile handles empty metadata and non-email strings", () => {
  const fallback = extractUserProfile({
    email: "invalid-email-string",
    user_metadata: {},
  });
  assert.equal(fallback.name, "Administrador");
  assert.equal(fallback.initials, "A");
});
