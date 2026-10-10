import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  isUnsafeHost,
  MAX_ARTICLES_PER_FEED,
  MAX_FEED_RESPONSE_BYTES,
  type FeedFormat,
} from "@tayori/shared";

export interface ParsedArticle {
  keyKind: "id" | "url" | "fallback";
  keyValue: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  publishedAt: number | null;
  contentHash: string;
}

export interface ParsedFeed {
  format: FeedFormat;
  title: string | null;
  articles: ParsedArticle[];
}

type XmlObject = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
});

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedParseError";
  }
}

export async function parseFeed(xml: string, feedUrl: string): Promise<ParsedFeed> {
  if (new TextEncoder().encode(xml).byteLength > MAX_FEED_RESPONSE_BYTES) {
    throw new FeedParseError("Feed response exceeded the size limit.");
  }
  if (/<!DOCTYPE/i.test(xml)) {
    throw new FeedParseError("DOCTYPE declarations are not accepted.");
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new FeedParseError("Feed XML is malformed.");
  }

  const document = parser.parse(xml) as XmlObject;
  const rss = asObject(document.rss);
  const channel = asObject(rss?.channel);
  const atom = asObject(document.feed);
  const root = channel ?? atom;
  if (!root) throw new FeedParseError("Document is not RSS or Atom.");

  const rawItems = channel ? asArray(root.item) : asArray(root.entry);
  if (rawItems.length > MAX_ARTICLES_PER_FEED) {
    throw new FeedParseError("Feed contains too many entries.");
  }

  const format: FeedFormat = channel ? "rss" : atom ? "atom" : "unknown";
  const articles: ParsedArticle[] = [];
  for (const value of rawItems) {
    const item = asObject(value);
    if (!item) continue;
    const title = cleanText(readScalar(item.title)) || "（タイトルなし）";
    const url = resolveArticleUrl(item, feedUrl);
    if (!url) continue;
    const id = cleanText(readScalar(item.id ?? item.guid));
    const publishedAt = parseDate(
      readScalar(item.pubDate ?? item.published ?? item.updated ?? item.date),
    );
    const author = cleanText(readScalar(item.author ?? item.creator)) || null;
    const summary = cleanText(readScalar(item.description ?? item.summary ?? item.encoded)) || null;
    const keyKind: ParsedArticle["keyKind"] = id ? "id" : "url";
    const keyValue = id || url;
    const contentHash = await sha256(JSON.stringify({ title, url, author, summary, publishedAt }));
    articles.push({ keyKind, keyValue, title, url, author, summary, publishedAt, contentHash });
  }

  return {
    format,
    title: cleanText(readScalar(root.title)) || null,
    articles,
  };
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isSafeFeedTarget(input: string): boolean {
  try {
    const url = new URL(input);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password && !isUnsafeHost(url.hostname);
  } catch {
    return false;
  }
}

function resolveArticleUrl(item: XmlObject, baseUrl: string): string | null {
  const linkValue = item.link;
  let raw: string | null = null;
  if (typeof linkValue === "string") raw = linkValue;
  else if (Array.isArray(linkValue)) {
    const links = linkValue.map(asObject).filter((link): link is XmlObject => link !== null);
    const selected = links.find((link) => link["@_rel"] === "alternate") ??
      links.find((link) => !link["@_rel"]) ?? links[0];
    raw = selected ? String(selected["@_href"] ?? "") : null;
  } else {
    const link = asObject(linkValue);
    raw = link ? String(link["@_href"] ?? "") : null;
  }
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    if (!isSafeFeedTarget(url.toString())) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function asObject(value: unknown): XmlObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as XmlObject
    : null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function readScalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const object = asObject(value);
  return object ? readScalar(object["#text"] ?? object.value) : "";
}

function cleanText(value: string): string {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, body: string) => {
    if (body[0] !== "#") return named[body.toLowerCase()] ?? entity;
    const codePoint = body[1]?.toLowerCase() === "x"
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    try {
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "�";
    } catch {
      return "�";
    }
  });
}

function parseDate(value: string): number | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}
