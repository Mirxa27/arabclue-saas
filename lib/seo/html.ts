/**
 * Minimal, linear-time HTML scanner for the SEO site audit (lib/seo/audit.ts).
 *
 * Not a full HTML5 parser: it walks the markup once, skips comments, doctype, <style> and
 * <script> bodies (keeping JSON-LD), and records only what the audit checks — <html lang/dir>,
 * <title>, the description / robots / viewport metas, canonical links, Open Graph tags, <h1>
 * text, <img alt> coverage and JSON-LD @types. Input is the bounded page body
 * (lib/seo/fetch-page.ts caps it), and every collection below is capped as well, so a hostile
 * page cannot make the scan expensive. Pure and dependency-free.
 */

export type ScannedPage = {
  htmlLang: string | null;
  htmlDir: string | null;
  bodyDir: string | null;
  title: string | null;
  titleCount: number;
  metaDescription: string | null;
  metaDescriptionCount: number;
  metaRobots: string | null;
  metaViewport: string | null;
  canonical: string | null;
  canonicalCount: number;
  ogTitle: string | null;
  ogImage: string | null;
  h1: string[];
  h1Count: number;
  images: { total: number; missingAlt: number; emptyAlt: number; missingAltSamples: string[] };
  jsonLdTypes: string[];
  jsonLdInvalid: number;
};

const MAX_TEXT = 300;
const MAX_H1_KEPT = 5;
const MAX_IMG_SAMPLES = 5;
const MAX_JSONLD_BLOCK = 200_000;
const MAX_JSONLD_TYPES = 50;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™"
};

/** Decode the entities that matter for titles and descriptions (named subset + numeric). */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** Collapse whitespace and cap length (text shown back to the merchant). */
export function cleanText(input: string, max = MAX_TEXT): string {
  const text = decodeEntities(input).replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

type Attrs = Map<string, string>;

const NAME_END = /[\s/>]/;

/** Parse the attributes of a start tag from `src[i]` until the closing `>`. Returns [attrs, index after '>']. */
function parseAttributes(src: string, start: number): [Attrs, number, boolean] {
  const attrs: Attrs = new Map();
  let i = start;
  const n = src.length;
  let selfClosing = false;
  while (i < n) {
    const c = src[i];
    if (c === ">") return [attrs, i + 1, selfClosing];
    if (c === "/" ) {
      selfClosing = true;
      i += 1;
      continue;
    }
    if (c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f") {
      i += 1;
      continue;
    }
    selfClosing = false;
    // attribute name
    let j = i;
    while (j < n && !NAME_END.test(src[j]) && src[j] !== "=") j += 1;
    if (j === i) {
      // stray character (e.g. a lone '='): skip it
      i += 1;
      continue;
    }
    const name = src.slice(i, j).toLowerCase();
    i = j;
    while (i < n && /\s/.test(src[i])) i += 1;
    let value = "";
    if (src[i] === "=") {
      i += 1;
      while (i < n && /\s/.test(src[i])) i += 1;
      const q = src[i];
      if (q === '"' || q === "'") {
        const end = src.indexOf(q, i + 1);
        const stop = end === -1 ? n : end;
        value = src.slice(i + 1, stop);
        i = end === -1 ? n : end + 1;
      } else {
        let k = i;
        while (k < n && !/[\s>]/.test(src[k])) k += 1;
        value = src.slice(i, k);
        i = k;
      }
    }
    if (!attrs.has(name)) attrs.set(name, decodeEntities(value));
  }
  return [attrs, n, selfClosing];
}

const CLOSE_TAG: Record<string, RegExp> = {};

/**
 * Index of the case-insensitive closing tag `</name` at or after `from` (or -1). A regex on the
 * original string, not indexOf on a lower-cased copy: toLowerCase can change the string length
 * (e.g. "İ"), which would shift every index after it.
 */
function findClose(src: string, name: string, from: number): number {
  const re = (CLOSE_TAG[name] ??= new RegExp(`</${name}`, "gi"));
  re.lastIndex = from;
  const m = re.exec(src);
  return m ? m.index : -1;
}

function collectJsonLdTypes(node: unknown, out: Set<string>, depth: number): void {
  if (depth > 6 || out.size >= MAX_JSONLD_TYPES || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 100)) collectJsonLdTypes(item, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (typeof type === "string") out.add(type.slice(0, 80));
  else if (Array.isArray(type)) for (const t of type.slice(0, 10)) if (typeof t === "string") out.add(t.slice(0, 80));
  if (obj["@graph"]) collectJsonLdTypes(obj["@graph"], out, depth + 1);
  for (const key of ["mainEntity", "itemListElement", "offers", "brand", "publisher"]) {
    if (obj[key]) collectJsonLdTypes(obj[key], out, depth + 1);
  }
}

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "noscript", "template", "svg"]);
const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9:-]*/;

export function scanHtml(html: string): ScannedPage {
  const page: ScannedPage = {
    htmlLang: null,
    htmlDir: null,
    bodyDir: null,
    title: null,
    titleCount: 0,
    metaDescription: null,
    metaDescriptionCount: 0,
    metaRobots: null,
    metaViewport: null,
    canonical: null,
    canonicalCount: 0,
    ogTitle: null,
    ogImage: null,
    h1: [],
    h1Count: 0,
    images: { total: 0, missingAlt: 0, emptyAlt: 0, missingAltSamples: [] },
    jsonLdTypes: [],
    jsonLdInvalid: 0
  };
  const types = new Set<string>();
  const n = html.length;
  let i = 0;
  let h1Depth = 0;
  let h1Text = "";

  const appendText = (text: string) => {
    if (h1Depth > 0 && h1Text.length < MAX_TEXT * 2) h1Text += text;
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      if (h1Depth > 0) appendText(html.slice(i));
      break;
    }
    if (lt > i && h1Depth > 0) appendText(html.slice(i, lt));
    i = lt;

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const closing = html[i + 1] === "/";
    const nameMatch = TAG_NAME.exec(html.slice(i + (closing ? 2 : 1), i + (closing ? 2 : 1) + 40));
    if (!nameMatch) {
      appendText("<");
      i += 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    const afterName = i + (closing ? 2 : 1) + nameMatch[0].length;

    if (closing) {
      const end = html.indexOf(">", afterName);
      i = end === -1 ? n : end + 1;
      if (name === "h1" && h1Depth > 0) {
        h1Depth -= 1;
        if (h1Depth === 0) {
          if (page.h1.length < MAX_H1_KEPT) page.h1.push(cleanText(h1Text));
          h1Text = "";
        }
      }
      continue;
    }

    const [attrs, next, selfClosing] = parseAttributes(html, afterName);
    i = next;

    switch (name) {
      case "html":
        page.htmlLang ??= attrs.get("lang")?.trim() || null;
        page.htmlDir ??= attrs.get("dir")?.trim().toLowerCase() || null;
        break;
      case "body":
        page.bodyDir ??= attrs.get("dir")?.trim().toLowerCase() || null;
        break;
      case "meta": {
        const metaName = (attrs.get("name") ?? "").trim().toLowerCase();
        const property = (attrs.get("property") ?? "").trim().toLowerCase();
        const content = attrs.get("content") ?? "";
        if (metaName === "description") {
          page.metaDescriptionCount += 1;
          page.metaDescription ??= cleanText(content);
        } else if (metaName === "robots" || metaName === "googlebot") {
          page.metaRobots = page.metaRobots ? `${page.metaRobots}, ${content}` : content;
        } else if (metaName === "viewport") {
          page.metaViewport ??= content;
        }
        if (property === "og:title") page.ogTitle ??= cleanText(content);
        if (property === "og:image") page.ogImage ??= content.trim() || null;
        break;
      }
      case "link": {
        const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
        if (rel.includes("canonical")) {
          page.canonicalCount += 1;
          page.canonical ??= attrs.get("href")?.trim() || null;
        }
        break;
      }
      case "img": {
        page.images.total += 1;
        if (!attrs.has("alt")) {
          page.images.missingAlt += 1;
          if (page.images.missingAltSamples.length < MAX_IMG_SAMPLES) {
            const src = attrs.get("src") ?? attrs.get("data-src") ?? "";
            page.images.missingAltSamples.push(cleanText(src, 160) || "(no src)");
          }
        } else if (!(attrs.get("alt") ?? "").trim()) {
          page.images.emptyAlt += 1;
        }
        break;
      }
      case "h1":
        page.h1Count += 1;
        if (!selfClosing) h1Depth += 1;
        break;
      default:
        break;
    }

    if (RAW_TEXT.has(name) && !selfClosing) {
      const close = findClose(html, name, i);
      const end = close === -1 ? n : close;
      const body = html.slice(i, end);
      if (name === "title") {
        page.titleCount += 1;
        page.title ??= cleanText(body);
      } else if (name === "script" && (attrs.get("type") ?? "").trim().toLowerCase() === "application/ld+json") {
        if (body.length > MAX_JSONLD_BLOCK) {
          page.jsonLdInvalid += 1;
        } else {
          try {
            collectJsonLdTypes(JSON.parse(body), types, 0);
          } catch {
            page.jsonLdInvalid += 1;
          }
        }
      }
      const gt = close === -1 ? -1 : html.indexOf(">", close);
      i = gt === -1 ? n : gt + 1;
    }
  }

  if (h1Depth > 0 && page.h1.length < MAX_H1_KEPT) page.h1.push(cleanText(h1Text));
  page.jsonLdTypes = [...types];
  return page;
}
