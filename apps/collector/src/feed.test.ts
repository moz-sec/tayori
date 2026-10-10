import { describe, expect, it } from "vitest";
import { isSafeFeedTarget, parseFeed } from "./feed";

describe("parseFeed", () => {
  it("parses RSS, strips markup, and keeps stable ids", async () => {
    const result = await parseFeed(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><item><guid>entry-1</guid><title>A &amp; B</title><link>https://example.com/post#section</link><description>&lt;p&gt;Hello&lt;/p&gt;</description><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`,
      "https://example.com/feed.xml",
    );
    expect(result.format).toBe("rss");
    expect(result.title).toBe("News");
    expect(result.articles[0]).toMatchObject({
      keyKind: "id",
      keyValue: "entry-1",
      title: "A & B",
      url: "https://example.com/post",
      summary: "Hello",
    });
  });

  it("parses Atom alternate links and relative URLs", async () => {
    const result = await parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>tag:example.com,2026:1</id><title>Entry</title><link rel="alternate" href="/entry/1"/><updated>2026-09-01T10:00:00Z</updated></entry></feed>`,
      "https://example.com/atom.xml",
    );
    expect(result.format).toBe("atom");
    expect(result.articles[0]?.url).toBe("https://example.com/entry/1");
  });

  it("rejects malformed XML, DTD, and private article links", async () => {
    await expect(parseFeed("<!DOCTYPE rss [<!ENTITY x 'y'>]><rss/>", "https://example.com/feed"))
      .rejects.toThrow(/DOCTYPE/);
    await expect(parseFeed("<rss><channel>", "https://example.com/feed"))
      .rejects.toThrow(/malformed/);
    const result = await parseFeed(
      `<rss><channel><item><title>x</title><link>http://127.0.0.1/x</link></item></channel></rss>`,
      "https://example.com/feed",
    );
    expect(result.articles).toHaveLength(0);
  });
});

describe("isSafeFeedTarget", () => {
  it.each(["http://localhost/feed", "http://10.0.0.4/feed", "http://169.254.169.254/", "file:///etc/passwd"])(
    "rejects %s",
    (url) => expect(isSafeFeedTarget(url)).toBe(false),
  );
  it("accepts public HTTP and HTTPS hosts", () => {
    expect(isSafeFeedTarget("https://feeds.example.com/rss")).toBe(true);
  });
});
