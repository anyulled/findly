import assert from "node:assert/strict";
import test from "node:test";
import { validateSource, type SourceInput } from "../src/lib/source-validation";

const validAccountId = "12345678-1234-1234-1234-123456789abc";
const validAccountId2 = "87654321-4321-4321-4321-cba987654321";

test("validateSource accepts valid luma_ical source with valid UUIDs", () => {
  const input: SourceInput = {
    name: " Barcelona JUG ",
    type: "luma_ical",
    url: "https://api.luma.com/ics/get?entity=calendar&id=cal-lIVEhrTJyvHLBAG",
    accountIds: [validAccountId, validAccountId2],
  };

  const result = validateSource(input);
  assert.equal(result.name, "Barcelona JUG");
  assert.equal(result.type, "luma_ical");
  assert.equal(result.url, "https://api.luma.com/ics/get?entity=calendar&id=cal-lIVEhrTJyvHLBAG");
  assert.deepEqual(result.accountIds, [validAccountId, validAccountId2]);
});

test("validateSource accepts valid meetup source on meetup.com", () => {
  const input: SourceInput = {
    name: "Meetup Group",
    type: "meetup",
    url: "https://www.meetup.com/barcelonajug/events/",
    accountIds: [validAccountId],
  };

  const result = validateSource(input);
  assert.equal(result.name, "Meetup Group");
  assert.equal(result.type, "meetup");
  assert.equal(result.url, "https://www.meetup.com/barcelonajug/events/");
  assert.deepEqual(result.accountIds, [validAccountId]);
});

test("validateSource rejects null, non-object or missing name/url/accountIds", () => {
  assert.throws(() => validateSource(null as unknown as SourceInput), /Los datos de la fuente no son válidos/);
  assert.throws(() => validateSource(undefined as unknown as SourceInput), /Los datos de la fuente no son válidos/);
  assert.throws(() => validateSource({ name: 123 } as unknown as SourceInput), /Los datos de la fuente no son válidos/);
  assert.throws(() => validateSource({ name: "A", url: 123 } as unknown as SourceInput), /Los datos de la fuente no son válidos/);
  assert.throws(() => validateSource({ name: "A", url: "https://test.com", accountIds: "bad" } as unknown as SourceInput), /Los datos de la fuente no son válidos/);
});

test("validateSource rejects empty or overlong names", () => {
  assert.throws(
    () => validateSource({ name: "   ", type: "luma_ical", url: "https://example.com/cal.ics", accountIds: [validAccountId] }),
    /El nombre de la fuente debe tener entre 1 y 120 caracteres/
  );
  assert.throws(
    () => validateSource({ name: "x".repeat(121), type: "luma_ical", url: "https://example.com/cal.ics", accountIds: [validAccountId] }),
    /El nombre de la fuente debe tener entre 1 y 120 caracteres/
  );
});

test("validateSource rejects unsupported source types", () => {
  assert.throws(
    () => validateSource({ name: "Name", type: "rss" as unknown as "luma_ical", url: "https://example.com", accountIds: [validAccountId] }),
    /El tipo de fuente no es válido/
  );
});

test("validateSource rejects malformed URLs or non-HTTP protocols", () => {
  assert.throws(
    () => validateSource({ name: "Name", type: "luma_ical", url: "not-a-url", accountIds: [validAccountId] }),
    /Introduce una URL válida para la fuente/
  );
  assert.throws(
    () => validateSource({ name: "Name", type: "luma_ical", url: "ftp://example.com/cal.ics", accountIds: [validAccountId] }),
    /La URL debe usar HTTP o HTTPS/
  );
});

test("validateSource rejects meetup sources outside meetup.com", () => {
  assert.throws(
    () => validateSource({ name: "Name", type: "meetup", url: "https://otherdomain.com/events", accountIds: [validAccountId] }),
    /La URL de Meetup debe pertenecer a meetup.com/
  );
});

test("validateSource rejects non-UUID account IDs such as acc-personal", () => {
  assert.throws(
    () => validateSource({ name: "Name", type: "luma_ical", url: "https://example.com/cal.ics", accountIds: ["acc-personal"] }),
    /Asocia la fuente al menos con una cuenta válida/
  );
  assert.throws(
    () => validateSource({ name: "Name", type: "luma_ical", url: "https://example.com/cal.ics", accountIds: [] }),
    /Asocia la fuente al menos con una cuenta válida/
  );
  assert.throws(
    () =>
      validateSource({
        name: "Name",
        type: "luma_ical",
        url: "https://example.com/cal.ics",
        accountIds: Array.from({ length: 21 }, (_, i) => validAccountId.slice(0, -2) + String(i).padStart(2, "0")),
      }),
    /Asocia la fuente al menos con una cuenta válida/
  );
});
