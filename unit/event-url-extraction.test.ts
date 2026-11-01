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

test("extracts date, time and location from generic HTML classes and text patterns", () => {
  const genericHtml = `<!doctype html>
  <html><head><meta property="og:title" content="Upskilling Week Autumn Edition - Mobile World Capital">
  <meta property="og:description" content="Upskilling digital workshop.">
  </head><body>
    <div class="post-event-date">16/NOV/2026 - 19/NOV/2026</div>
    <div class="post-location">Cibernàrium 22@ - Barcelona Activa</div>
    <div class="post-time">15:00 - 20:00 h.</div>
  </body></html>`;
  const result = parseEventPage(genericHtml, "https://mobileworldcapital.com/en/agenda/upskilling-week-november-2026/");
  assert.equal(result.event.title, "Upskilling Week Autumn Edition - Mobile World Capital");
  assert.equal(result.event.date, "2026-11-16");
  assert.equal(result.event.time, "15:00");
  assert.equal(result.event.place, "Cibernàrium 22@ - Barcelona Activa");
  assert.equal(result.event.description, "Upskilling digital workshop.");
  assert.deepEqual(result.missingFields, []);
});

test("rejects unsupported sources before making a request", async () => {
  let requests = 0;
  const mockFetch = async () => { requests += 1; return new Response(); };
  await assert.rejects(extractEventPageDetails("http://127.0.0.1/private", mockFetch), EventUrlExtractionError);
  await assert.rejects(extractEventPageDetails("https://user:pass@example.com/event", mockFetch), EventUrlExtractionError);
  await assert.rejects(extractEventPageDetails("https://example.com:8080/event", mockFetch), EventUrlExtractionError);
  await assert.rejects(extractEventPageDetails("https://localhost/event", mockFetch), EventUrlExtractionError);
  await assert.rejects(extractEventPageDetails("https://10.0.0.1/event", mockFetch), EventUrlExtractionError);
  await assert.rejects(extractEventPageDetails("https://192.168.1.1/event", mockFetch), EventUrlExtractionError);
  await assert.rejects(extractEventPageDetails("https://172.20.0.1/event", mockFetch), EventUrlExtractionError);
  await assert.rejects(extractEventPageDetails("https://169.254.169.254/latest/meta-data", mockFetch), EventUrlExtractionError);
  await assert.rejects(extractEventPageDetails("not-a-valid-url", mockFetch), EventUrlExtractionError);
  assert.equal(requests, 0);
});

test("rejects an overlong URL before making a request", async () => {
  let requests = 0;
  await assert.rejects(
    extractEventPageDetails(`https://example.com/${"a".repeat(2_050)}`, async () => { requests += 1; return new Response(); }),
    /2048/u,
  );
  assert.equal(requests, 0);
});

test("blocks redirects to non-HTTPS or private hosts", async () => {
  await assert.rejects(extractEventPageDetails("https://example.com/event", async () => new Response(null, {
    status: 302,
    headers: { location: "http://example.org/collect" },
  })), /no admitido/u);
  await assert.rejects(extractEventPageDetails("https://example.com/event", async () => new Response(null, {
    status: 302,
    headers: { location: "https://127.0.0.1/private" },
  })), /no admitido/u);
});

test("follows a redirect between valid public HTTPS hosts", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    if (urls.length === 1) return new Response(null, { status: 301, headers: { location: "https://other-domain.org/java-evening" } });
    return new Response(eventPage, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const result = await extractEventPageDetails("https://example.com/java-evening", fetchImpl);
  assert.equal(urls.length, 2);
  assert.equal(result.event.url, "https://other-domain.org/java-evening");
});

test("rejects non-HTML and oversized pages", async () => {
  await assert.rejects(extractEventPageDetails("https://example.com/event", async () => new Response("text", {
    headers: { "content-type": "application/json" },
  })), /HTML/u);
  await assert.rejects(extractEventPageDetails("https://example.com/event", async () => new Response("", {
    headers: { "content-type": "text/html", "content-length": "1100000" },
  })), /grande/u);
});

test("rejects a page without an event title", () => {
  assert.throws(() => parseEventPage("<html><body>Not an event</body></html>", "https://example.com/not-an-event"), EventUrlExtractionError);
});

test("extracts Substack article metadata and cover image without requiring date/time/place", () => {
  const substackHtml = `<!doctype html>
  <html><head>
    <meta property="og:title" content="La eternidad está en el presente">
    <meta property="og:description" content="De la cinta de Moebius al presente continuo">
    <meta property="og:image" content="https://substackcdn.com/image/cover.jpg">
  </head><body></body></html>`;
  const result = parseEventPage(substackHtml, "https://etsideusnondaretur.substack.com/p/la-eternidad");
  assert.equal(result.event.title, "La eternidad está en el presente");
  assert.equal(result.event.description, "De la cinta de Moebius al presente continuo");
  assert.equal(result.event.imageUrl, "https://substackcdn.com/image/cover.jpg");
  assert.deepEqual(result.missingFields, []);
});

test("extracts latest Substack post from /feed and enriches cover image from /api/v1/posts", async () => {
  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <item>
        <title><![CDATA[La eternidad está en el presente]]></title>
        <description><![CDATA[De la cinta de Moebius al presente continuo]]></description>
        <link>https://etsideusnondaretur.substack.com/p/la-eternidad</link>
        <pubDate>Sat, 28 Mar 2026 09:15:10 GMT</pubDate>
      </item>
    </channel></rss>`;
  const apiJson = JSON.stringify([
    {
      id: 1,
      title: "La eternidad está en el presente",
      description: "De la cinta de Moebius al presente continuo",
      canonical_url: "https://etsideusnondaretur.substack.com/p/la-eternidad",
      cover_image: "https://substackcdn.com/image/api-cover.jpg",
    },
  ]);

  const result = await extractEventPageDetails("https://etsideusnondaretur.substack.com/feed", async (input) => {
    const url = String(input);
    if (url.endsWith("/api/v1/posts")) {
      return new Response(apiJson, { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(rssXml, { status: 200, headers: { "content-type": "application/rss+xml" } });
  });

  assert.equal(result.event.title, "La eternidad está en el presente");
  assert.equal(result.event.description, "De la cinta de Moebius al presente continuo");
  assert.equal(result.event.url, "https://etsideusnondaretur.substack.com/p/la-eternidad");
  assert.equal(result.event.imageUrl, "https://substackcdn.com/image/api-cover.jpg");
  assert.deepEqual(result.missingFields, []);
});

test("extracts next upcoming event when pasting a Meetup RSS feed URL", async () => {
  const jugRss = `<?xml version="1.0" encoding="utf-8"?>
    <rss version="2.0"><channel>
      <item>
        <title><![CDATA[⚡Lightning Talks: Java 27]]></title>
        <link>https://www.meetup.com/barcelonajug/events/317230196/</link>
        <guid>https://www.meetup.com/barcelonajug/events/317230196/</guid>
        <pubDate>Sun, 01 Nov 2026 00:27:23 GMT</pubDate>
        <description><![CDATA[📅 **Jueves, 19 de noviembre de 2026**\n🏢 **Skyscanner**\n📍 Gran Via de les Corts Catalanes, 764, Barcelona.]]></description>
      </item>
    </channel></rss>`;

  const result = await extractEventPageDetails("https://www.meetup.com/barcelonajug/events/rss/", async (input) => {
    const url = String(input);
    if (url.endsWith("/events/rss/")) {
      return new Response(jugRss, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
  });

  assert.equal(result.event.title, "⚡Lightning Talks: Java 27");
  assert.equal(result.event.date, "2026-11-19");
  assert.equal(result.event.time, "18:30");
  assert.equal(result.event.place, "Skyscanner, Gran Via de les Corts Catalanes, 764, Barcelona");
  assert.equal(result.event.url, "https://www.meetup.com/barcelonajug/events/317230196/");
  assert.deepEqual(result.missingFields, []);
});
