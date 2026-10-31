import assert from "node:assert/strict";
import test from "node:test";
import { EventUrlExtractionError, extractEventPageDetails, parseEventPage } from "../src/lib/event-url-extraction";

const eventPage = `<!doctype html>
<html><head><meta property="og:title" content="Community Java Evening">
<meta property="og:description" content="Talks &amp; community.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Barcelona JUG: Java &amp; Friends","startDate":"2027-01-15T18:30:00+01:00","description":"A meetup for Java developers.","location":{"@type":"Place","name":"Talent Arena","address":{"addressLocality":"Barcelona"}}}</script>
</head></html>`;

test("uses structured event data and converts its start time to Madrid", () => {
  const result = parseEventPage(eventPage, "https://luma.com/java-evening");
  assert.deepEqual(result.event, {
    title: "Barcelona JUG: Java & Friends",
    date: "2027-01-15",
    time: "18:30",
    place: "Talent Arena, Barcelona",
    description: "A meetup for Java developers.",
    url: "https://luma.com/java-evening",
  });
  assert.deepEqual(result.missingFields, []);
});

test("falls back to page metadata and reports fields that still need manual entry", () => {
  const result = parseEventPage('<meta property="og:title" content="Craft Night"><meta name="description" content="Code &amp; chat">', "https://www.meetup.com/software-crafters-barcelona/events/123/");
  assert.equal(result.event.title, "Craft Night");
  assert.equal(result.event.description, "Code & chat");
  assert.deepEqual(result.missingFields, ["date", "time", "place"]);
});

test("preserves a floating ISO datetime as Madrid wall-clock time", () => {
  const result = parseEventPage('<script type="application/ld+json">{"@type":"Event","name":"Floating date","startDate":"2027-01-15T18:30:00"}</script>', "https://luma.com/floating");
  assert.equal(result.event.date, "2027-01-15");
  assert.equal(result.event.time, "18:30");
});

test("rejects unsupported sources before making a request", async () => {
  let requests = 0;
  await assert.rejects(
    extractEventPageDetails("http://127.0.0.1/private", async () => { requests += 1; return new Response(); }),
    EventUrlExtractionError,
  );
  assert.equal(requests, 0);
});

test("rejects an overlong URL before making a request", async () => {
  let requests = 0;
  await assert.rejects(
    extractEventPageDetails(`https://luma.com/${"a".repeat(2_050)}`, async () => { requests += 1; return new Response(); }),
    /2048/u,
  );
  assert.equal(requests, 0);
});

test("blocks redirects outside the supported event providers", async () => {
  await assert.rejects(extractEventPageDetails("https://luma.com/event", async () => new Response(null, {
    status: 302,
    headers: { location: "https://example.org/collect" },
  })), /dominio no admitido/u);
});

test("follows a redirect between supported provider hosts", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    if (urls.length === 1) return new Response(null, { status: 301, headers: { location: "https://luma.com/java-evening" } });
    return new Response(eventPage, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const result = await extractEventPageDetails("https://lu.ma/java-evening", fetchImpl);
  assert.equal(urls.length, 2);
  assert.equal(result.event.url, "https://luma.com/java-evening");
});

test("rejects non-HTML and oversized pages", async () => {
  await assert.rejects(extractEventPageDetails("https://luma.com/event", async () => new Response("text", {
    headers: { "content-type": "application/json" },
  })), /HTML/u);
  await assert.rejects(extractEventPageDetails("https://luma.com/event", async () => new Response("", {
    headers: { "content-type": "text/html", "content-length": "1100000" },
  })), /grande/u);
});

test("rejects a page without an event title", () => {
  assert.throws(() => parseEventPage("<html><body>Not an event</body></html>", "https://luma.com/not-an-event"), EventUrlExtractionError);
});
