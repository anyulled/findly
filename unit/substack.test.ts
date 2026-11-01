import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSubstackUrl,
  normalizeSubstackPostsApiUrl,
  packLocationAndImage,
  unpackLocationAndImage,
  parseSubstackPostsJson,
  parseSubstackRssFeed,
  parseSubstackFeed,
} from "../src/lib/substack";

describe("substack utilities", () => {
  it("detects Substack URLs accurately", () => {
    assert.equal(isSubstackUrl("https://etsideusnondaretur.substack.com/feed"), true);
    assert.equal(isSubstackUrl("https://etsideusnondaretur.substack.com/api/v1/posts"), true);
    assert.equal(isSubstackUrl("https://substack.com/@user"), true);
    assert.equal(isSubstackUrl("https://custom.domain.com/api/v1/posts"), true);
    assert.equal(isSubstackUrl("https://lu.ma/bcnjs"), false);
    assert.equal(isSubstackUrl(""), false);
    assert.equal(isSubstackUrl(null), false);
    assert.equal(isSubstackUrl("not-a-url"), false);
  });

  it("normalizes Substack feed URLs to /api/v1/posts", () => {
    assert.equal(
      normalizeSubstackPostsApiUrl("https://etsideusnondaretur.substack.com/feed"),
      "https://etsideusnondaretur.substack.com/api/v1/posts",
    );
  });

  it("packs and unpacks location and cover image URL", () => {
    assert.equal(
      packLocationAndImage("", "https://substackcdn.com/image/cover.jpg"),
      "https://substackcdn.com/image/cover.jpg",
    );
    assert.equal(
      packLocationAndImage("Barcelona", "https://substackcdn.com/image/cover.jpg"),
      "Barcelona\nhttps://substackcdn.com/image/cover.jpg",
    );
    assert.equal(packLocationAndImage("Barcelona", null), "Barcelona");

    assert.deepEqual(unpackLocationAndImage("https://substackcdn.com/image/cover.jpg"), {
      place: "",
      imageUrl: "https://substackcdn.com/image/cover.jpg",
    });
    assert.deepEqual(unpackLocationAndImage("Barcelona\nhttps://substackcdn.com/image/cover.jpg"), {
      place: "Barcelona",
      imageUrl: "https://substackcdn.com/image/cover.jpg",
    });
    assert.deepEqual(unpackLocationAndImage("Barcelona"), { place: "Barcelona" });
    assert.deepEqual(unpackLocationAndImage(""), { place: "" });
  });

  it("parses Substack /api/v1/posts JSON array and object wrapper", () => {
    const raw = JSON.stringify([
      {
        id: 192356480,
        title: "La eternidad está en el presente &amp; más&#x2014;hoy &#8212;",
        description: "De la cinta de Moebius al presente continuo en nuestro día a día",
        canonical_url: "https://etsideusnondaretur.substack.com/p/la-eternidad",
        post_date: "2026-03-28T09:15:10.742Z",
        cover_image: "https://substackcdn.com/image/fetch/cover1.jpg",
      },
      {
        slug: "segundo-articulo",
        title: "Segundo artículo",
        subtitle: "<p>Subtítulo con HTML</p>",
        podcast_episode_image_url: "https://substackcdn.com/image/fetch/podcast.jpg",
      },
      {
        title: "",
      },
      null,
    ]);

    const items = parseSubstackPostsJson(raw, "https://etsideusnondaretur.substack.com/api/v1/posts");
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], {
      uid: "192356480",
      title: "La eternidad está en el presente & más—hoy —",
      description: "De la cinta de Moebius al presente continuo en nuestro día a día",
      url: "https://etsideusnondaretur.substack.com/p/la-eternidad",
      publishedAt: "2026-03-28T09:15:10.742Z",
      coverImage: "https://substackcdn.com/image/fetch/cover1.jpg",
    });
    assert.equal(items[1]?.url, "https://etsideusnondaretur.substack.com/p/segundo-articulo");
    assert.equal(items[1]?.description, "Subtítulo con HTML");
    assert.equal(items[1]?.coverImage, "https://substackcdn.com/image/fetch/podcast.jpg");

    const wrapped = parseSubstackFeed(
      JSON.stringify({ posts: [{ title: "Desde objeto", body_html: "<p>Texto</p>" }] }),
      "https://etsideusnondaretur.substack.com/api/v1/posts",
    );
    assert.equal(wrapped.length, 1);
    assert.equal(wrapped[0]?.url, "https://etsideusnondaretur.substack.com");
    assert.equal(wrapped[0]?.coverImage, null);
  });

  it("parses Substack RSS feed XML with itunes:image, enclosure, img, and channel fallback", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <image><url>https://substackcdn.com/image/channel-default.png</url></image>
          <item>
            <title><![CDATA[La eternidad está en el presente]]></title>
            <description><![CDATA[De la cinta de Moebius al presente continuo]]></description>
            <link>https://etsideusnondaretur.substack.com/p/la-eternidad</link>
            <guid isPermaLink="false">https://etsideusnondaretur.substack.com/p/la-eternidad</guid>
            <pubDate>Sat, 28 Mar 2026 09:15:10 GMT</pubDate>
            <enclosure url="https://substackcdn.com/image/enclosure.jpg" length="0" type="image/jpeg"/>
          </item>
          <item>
            <title>Con itunes image</title>
            <content:encoded><![CDATA[<p>Contenido largo</p>]]></content:encoded>
            <itunes:image href="https://substackcdn.com/image/itunes.png"/>
          </item>
          <item>
            <title>Con img en contenido</title>
            <description><![CDATA[<p>Texto <img src="https://substackcdn.com/image/inline.png"/></p>]]></description>
          </item>
          <item>
            <title>Sin imagen propia</title>
            <description>Usa imagen del canal</description>
          </item>
        </channel>
      </rss>`;

    const items = parseSubstackRssFeed(xml, "https://etsideusnondaretur.substack.com/feed");
    assert.equal(items.length, 4);
    assert.equal(items[0]?.title, "La eternidad está en el presente");
    assert.equal(items[0]?.description, "De la cinta de Moebius al presente continuo");
    assert.equal(items[0]?.coverImage, "https://substackcdn.com/image/enclosure.jpg");
    assert.equal(items[1]?.coverImage, "https://substackcdn.com/image/itunes.png");
    assert.equal(items[2]?.coverImage, "https://substackcdn.com/image/inline.png");
    assert.equal(items[3]?.coverImage, "https://substackcdn.com/image/channel-default.png");

    assert.equal(parseSubstackFeed(xml, "https://etsideusnondaretur.substack.com/feed").length, 4);
  });
});
