import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanMeetupDescription,
  enrichMeetupRssItems,
  extractMeetupGroupSlug,
  isMeetupUrl,
  normalizeMeetupIcalUrl,
  normalizeMeetupRssUrl,
  parseMeetupFeed,
  parseMeetupRssFeed,
} from "../src/lib/meetup";

const barcelonaJugRss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
    <channel>
        <title>Events - Barcelona JUG</title>
        <link>https://www.meetup.com/barcelonajug/events/</link>
        <item>
            <title><![CDATA[⚡Lightning Talks: Java 27]]></title>
            <link>https://www.meetup.com/barcelonajug/events/317230196/</link>
            <guid>https://www.meetup.com/barcelonajug/events/317230196/</guid>
            <pubDate>Sun, 01 Nov 2026 00:27:23 GMT</pubDate>
            <description><![CDATA[Register at [https://luma.com/7etvz4bf](https://luma.com/7etvz4bf)

¡Java 27 está en camino y queremos descubrir juntos sus novedades!
📍 ¿Cuándo y dónde?
📅 **Jueves, 19 de noviembre de 2026**
🏢 **Skyscanner**
📍 Gran Via de les Corts Catalanes, 764, Barcelona.]]></description>
        </item>
        <item>
            <title><![CDATA[AI Writes the Code. Who’s in Control?]]></title>
            <link>https://www.meetup.com/barcelonajug/events/317230293/</link>
            <guid>https://www.meetup.com/barcelonajug/events/317230293/</guid>
            <pubDate>Sun, 01 Nov 2026 00:33:23 GMT</pubDate>
            <description><![CDATA[Join [Barcelona JUG](https://www.meetup.com/barcelonajug/) on 2026-11-26 at 18:00h.]]></description>
        </item>
    </channel>
</rss>`;

const emptyCraftersRss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
    <channel>
        <title>Events - Software Crafters Barcelona</title>
        <link>https://www.meetup.com/software-crafters-barcelona/events/</link>
    </channel>
</rss>`;

describe("meetup utilities", () => {
  it("detects Meetup URLs and normalizes group URLs to /events/rss/ and /events/ical/", () => {
    assert.equal(isMeetupUrl("https://www.meetup.com/barcelonajug/events/rss/"), true);
    assert.equal(isMeetupUrl("https://meetup.com/software-crafters-barcelona/"), true);
    assert.equal(isMeetupUrl("https://lu.ma/bcnjs"), false);
    assert.equal(isMeetupUrl(null), false);
    assert.equal(isMeetupUrl("not-a-url"), false);

    assert.equal(extractMeetupGroupSlug("https://www.meetup.com/barcelonajug/events/rss/"), "barcelonajug");
    assert.equal(extractMeetupGroupSlug("https://www.meetup.com/es-ES/software-crafters-barcelona/events/"), "software-crafters-barcelona");
    assert.equal(extractMeetupGroupSlug("https://www.meetup.com/"), null);
    assert.equal(extractMeetupGroupSlug("https://example.com/group"), null);

    assert.equal(
      normalizeMeetupRssUrl("https://www.meetup.com/barcelonajug/"),
      "https://www.meetup.com/barcelonajug/events/rss/",
    );
    assert.equal(
      normalizeMeetupIcalUrl("https://www.meetup.com/es-ES/barcelonajug/events/rss/"),
      "https://www.meetup.com/barcelonajug/events/ical/",
    );
  });

  it("cleans Meetup markdown and HTML entities in descriptions", () => {
    const cleaned = cleanMeetupDescription(
      "<![CDATA[Register at [https://luma.com/abc](https://luma.com/abc) &amp; [Docs](https://docs.example.com) **Bold** *Italic* &#x2014; &#8212;]]>",
    );
    assert.equal(cleaned, "Register at https://luma.com/abc & Docs (https://docs.example.com) Bold Italic — —");
  });

  it("parses Meetup RSS feeds with active events and empty feeds without errors", () => {
    const items = parseMeetupRssFeed(barcelonaJugRss, "https://www.meetup.com/barcelonajug/events/rss/");
    assert.equal(items.length, 2);
    assert.equal(items[0]?.uid, "event_317230196@meetup.com");
    assert.equal(items[0]?.title, "⚡Lightning Talks: Java 27");
    assert.equal(items[0]?.url, "https://www.meetup.com/barcelonajug/events/317230196/");
    assert.equal(items[0]?.startsAt, "2026-11-19T17:30:00.000Z");
    assert.equal(items[0]?.location, "Skyscanner, Gran Via de les Corts Catalanes, 764, Barcelona");

    assert.equal(items[1]?.uid, "event_317230293@meetup.com");
    assert.equal(items[1]?.startsAt, "2026-11-26T17:00:00.000Z");
    assert.equal(items[1]?.location, "Barcelona");

    const empty = parseMeetupRssFeed(emptyCraftersRss, "https://www.meetup.com/software-crafters-barcelona/events/rss/");
    assert.deepEqual(empty, []);
  });

  it("enriches Meetup RSS items from iCal and event page JSON-LD", async () => {
    const baseItems = parseMeetupRssFeed(barcelonaJugRss, "https://www.meetup.com/barcelonajug/events/rss/");
    const sampleIcal = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Meetup//Meetup Calendar 1.0//EN
BEGIN:VEVENT
UID:event_317230293@meetup.com
DTSTART;TZID=Europe/Madrid:20261126T180000
SUMMARY:AI Writes the Code. Who’s in Control?
END:VEVENT
END:VCALENDAR`;
    const sampleEventHtml = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Event",
        name: "⚡Lightning Talks: Java 27",
        startDate: "2026-11-19T18:30:00+01:00",
        image: ["https://secure-content.meetupstatic.com/images/classic-events/536904898/676x676.jpg"],
        location: {
          "@type": "Place",
          name: "Skyscanner",
          address: { addressLocality: "Barcelona" },
        },
      })}</script>
    </head></html>`;

    const enriched = await enrichMeetupRssItems(
      baseItems,
      "https://www.meetup.com/barcelonajug/events/rss/",
      async (input) => {
        const url = String(input);
        if (url.endsWith("/events/ical/")) return new Response(sampleIcal, { status: 200 });
        if (url.includes("317230196")) return new Response(sampleEventHtml, { status: 200 });
        return new Response("<html></html>", { status: 200 });
      },
    );

    assert.equal(enriched[0]?.startsAt, "2026-11-19T17:30:00.000Z");
    assert.equal(enriched[0]?.location, "Skyscanner, Barcelona");
    assert.equal(enriched[0]?.coverImage, "https://secure-content.meetupstatic.com/images/classic-events/536904898/676x676.jpg");
    assert.equal(enriched[1]?.startsAt, "2026-11-26T17:00:00.000Z");
  });

  it("parses JSON, iCal, and RSS via parseMeetupFeed", () => {
    const fromRss = parseMeetupFeed(barcelonaJugRss, "https://www.meetup.com/barcelonajug/events/rss/");
    assert.equal(fromRss.length, 2);

    const fromJson = parseMeetupFeed(JSON.stringify(fromRss), "https://www.meetup.com/barcelonajug/events/rss/");
    assert.equal(fromJson.length, 2);

    const fromIcal = parseMeetupFeed(
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:e1\nDTSTART:20261119T173000Z\nSUMMARY:Meetup iCal\nEND:VEVENT\nEND:VCALENDAR`,
      "https://www.meetup.com/barcelonajug/events/ical/",
    );
    assert.equal(fromIcal.length, 1);
    assert.equal(fromIcal[0]?.title, "Meetup iCal");
  });
});
