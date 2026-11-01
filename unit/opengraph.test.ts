import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractImageFromHtml, fetchOpenGraphImage } from "../src/lib/opengraph";

describe("OpenGraph & JSON-LD image extraction", () => {
  it("extracts og:image and og:image:secure_url from meta tags", () => {
    const html = `
      <html><head>
        <meta property="og:image" content="https://images.lumacdn.com/event-cover.jpg" />
      </head></html>
    `;
    assert.equal(
      extractImageFromHtml(html, "https://lu.ma/java-27"),
      "https://images.lumacdn.com/event-cover.jpg",
    );

    const htmlSecure = `
      <html><head>
        <meta property="og:image" content="https://images.lumacdn.com/fallback.jpg" />
        <meta property="og:image:secure_url" content="https://images.lumacdn.com/secure.jpg" />
      </head></html>
    `;
    assert.equal(
      extractImageFromHtml(htmlSecure, "https://lu.ma/java-27"),
      "https://images.lumacdn.com/secure.jpg",
    );
  });

  it("extracts twitter:image, resolves relative URLs, and decodes HTML entities", () => {
    const html = `
      <html><head>
        <meta name='twitter:image' content='/images/banner.png?w=1200&amp;h=630&#x26;fit=crop&#38;q=80' />
      </head></html>
    `;
    assert.equal(
      extractImageFromHtml(html, "https://example.org/events/meetup"),
      "https://example.org/images/banner.png?w=1200&h=630&fit=crop&q=80",
    );
  });

  it("extracts images from JSON-LD objects, arrays, ImageObject, and @graph", () => {
    const htmlString = `<script type="application/ld+json">{"@type":"Event","image":"https://secure.meetupstatic.com/photos/event/1.webp"}</script>`;
    assert.equal(
      extractImageFromHtml(htmlString, "https://www.meetup.com/barcelonajug/events/1/"),
      "https://secure.meetupstatic.com/photos/event/1.webp",
    );

    const htmlObject = `<script type="application/ld+json">[{"@type":"Event","image":{"@type":"ImageObject","contentUrl":"/assets/cover.png"}}]</script>`;
    assert.equal(
      extractImageFromHtml(htmlObject, "https://www.meetup.com/barcelonajug/events/1/"),
      "https://www.meetup.com/assets/cover.png",
    );

    const htmlGraph = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Event","thumbnailUrl":["http://insecure.example.com/a.jpg","https://cdn.example.com/thumb.jpg"]}]}</script>`;
    assert.equal(
      extractImageFromHtml(htmlGraph, "https://example.com"),
      "https://cdn.example.com/thumb.jpg",
    );
  });

  it("rejects non-HTTPS or private network image URLs and handles missing images", () => {
    const htmlPrivate = `<meta property="og:image" content="https://127.0.0.1/secret.png" />`;
    assert.equal(extractImageFromHtml(htmlPrivate, "https://example.com"), null);
    assert.equal(extractImageFromHtml("<html><head></head></html>", "https://example.com"), null);
  });

  it("fetches OpenGraph images over HTTPS, follows safe redirects, and blocks private hosts", async () => {
    assert.equal(await fetchOpenGraphImage(null), null);
    assert.equal(await fetchOpenGraphImage("not-a-url"), null);
    assert.equal(await fetchOpenGraphImage("http://lu.ma/java-27"), null);
    assert.equal(await fetchOpenGraphImage("https://localhost/event"), null);

    let calls = 0;
    const image = await fetchOpenGraphImage("https://lu.ma/java-27", async (input) => {
      calls += 1;
      const url = String(input);
      if (url === "https://lu.ma/java-27") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://luma.com/java-27" },
        });
      }
      return new Response(
        `<html><head><meta property="og:image" content="https://images.lumacdn.com/java-27.png"></head></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    assert.equal(calls, 2);
    assert.equal(image, "https://images.lumacdn.com/java-27.png");

    const failed = await fetchOpenGraphImage("https://lu.ma/missing", async () => new Response("Not found", { status: 404 }));
    assert.equal(failed, null);
  });
});
