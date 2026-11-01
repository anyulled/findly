import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeHtmlEntities,
  unwrapCdata,
  stripTagsAndClean,
  extractXmlTag,
} from "../src/lib/html-utils";

describe("html-utils", () => {
  it("decodeHtmlEntities decodes common named entities", () => {
    assert.equal(decodeHtmlEntities("&amp; &quot; &apos; &lt; &gt; &nbsp;"), '& " \' < >  ');
  });

  it("decodeHtmlEntities decodes hex and decimal numeric entities", () => {
    assert.equal(decodeHtmlEntities("&#x26; &#38; &#39;"), "& & '");
  });

  it("decodeHtmlEntities handles invalid code points gracefully", () => {
    assert.equal(decodeHtmlEntities("&#x110000;"), "");
    assert.equal(decodeHtmlEntities("&#9999999;"), "");
  });

  it("decodeHtmlEntities leaves unknown entities intact", () => {
    assert.equal(decodeHtmlEntities("&foo;"), "&foo;");
  });

  it("unwrapCdata unwraps CDATA blocks", () => {
    assert.equal(unwrapCdata("<![CDATA[Hello World]]>"), "Hello World");
    assert.equal(unwrapCdata("Plain Text"), "Plain Text");
  });

  it("stripTagsAndClean handles non-string, tags and whitespace", () => {
    assert.equal(stripTagsAndClean(null), "");
    assert.equal(stripTagsAndClean(undefined), "");
    assert.equal(stripTagsAndClean(123), "");
    assert.equal(stripTagsAndClean("<p>Hello &amp; <b>World</b></p>"), "Hello & World");
    assert.equal(stripTagsAndClean("<![CDATA[<p>Content&nbsp;&nbsp;here</p>]]>"), "Content here");
  });

  it("extractXmlTag extracts and unwraps inner content", () => {
    const xml = "<item><title><![CDATA[Special &amp; Event]]></title><link>https://lu.ma</link></item>";
    assert.equal(extractXmlTag(xml, "title"), "Special &amp; Event");
    assert.equal(extractXmlTag(xml, "link"), "https://lu.ma");
    assert.equal(extractXmlTag(xml, "missing"), "");
  });
});
