/**
 * X (Twitter) weighted post length, per X's counting rules and twitter-text config v3
 * (https://docs.x.com/fundamentals/counting-characters,
 *  https://github.com/twitter/twitter-text/blob/master/config/v3.json — read 2026-11-06):
 *
 *  - maxWeightedTweetLength 280, scale 100, defaultWeight 200;
 *  - code points in 0–4351 (Latin, Arabic, …), 8192–8205, 8208–8223 and 8242–8247 weigh 1,
 *    everything else (CJK, most symbols) weighs 2;
 *  - every emoji weighs 2 "regardless of complexity" (ZWJ sequences, skin tones, flags, keycaps);
 *  - every URL weighs 23 (transformedURLLength), whatever its real length;
 *  - the text is NFC-normalised first.
 *
 * URL detection is deliberately generous (any scheme URL, www. host or bare domain with a
 * 2–24 letter TLD counts as 23): over-counting can only make us shorten a caption X would
 * have accepted, never send one X rejects. Graphemes and URLs are never split.
 */

export const X_MAX_WEIGHTED_LENGTH = 280;
export const X_URL_WEIGHT = 23;

const WEIGHT_ONE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247]
];

const URL_RE =
  /(?:https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{2,5})?(?:\/[^\s<>"'`]*)?)/giu;
const TRAILING_PUNCTUATION_RE = /[.,!?;:'")\]}،؛؟…]+$/u;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

export type XToken = { text: string; weight: number; kind: "url" | "emoji" | "text" };

function codePointWeight(cp: number): number {
  for (const [start, end] of WEIGHT_ONE_RANGES) if (cp >= start && cp <= end) return 1;
  return 2;
}

let segmenter: Intl.Segmenter | null = null;
function graphemes(text: string): string[] {
  segmenter ??= new Intl.Segmenter("und", { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

function textTokens(text: string): XToken[] {
  return graphemes(text).map((g) => {
    if (EMOJI_RE.test(g)) return { text: g, weight: 2, kind: "emoji" };
    let weight = 0;
    for (const ch of g) weight += codePointWeight(ch.codePointAt(0)!);
    return { text: g, weight, kind: "text" };
  });
}

/** The caption split into atomic pieces (URLs, emoji, graphemes) with their X weights. */
export function tokenizeForX(input: string): XToken[] {
  const text = input.normalize("NFC");
  const tokens: XToken[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    const trailing = TRAILING_PUNCTUATION_RE.exec(url)?.[0] ?? "";
    if (trailing) url = url.slice(0, url.length - trailing.length);
    if (!url) continue;
    const start = match.index!;
    if (start > last) tokens.push(...textTokens(text.slice(last, start)));
    tokens.push({ text: url, weight: X_URL_WEIGHT, kind: "url" });
    last = start + url.length;
  }
  if (last < text.length) tokens.push(...textTokens(text.slice(last)));
  return tokens;
}

export function xWeightedLength(text: string): number {
  return tokenizeForX(text).reduce((sum, t) => sum + t.weight, 0);
}

export function isValidXLength(text: string, max = X_MAX_WEIGHTED_LENGTH): boolean {
  return xWeightedLength(text) <= max;
}

const ELLIPSIS = "…"; // U+2026 weighs 2

/**
 * Last-resort shortening to fit `max`: whole tokens only (a URL or emoji is kept or dropped,
 * never cut), backing off to the previous word boundary when that loses little, then "…".
 */
export function truncateForX(text: string, max = X_MAX_WEIGHTED_LENGTH): string {
  const normalized = text.normalize("NFC").trim();
  const tokens = tokenizeForX(normalized);
  const total = tokens.reduce((s, t) => s + t.weight, 0);
  if (total <= max) return normalized;

  const budget = max - xWeightedLength(ELLIPSIS);
  const kept: XToken[] = [];
  let used = 0;
  for (const token of tokens) {
    if (used + token.weight > budget) break;
    kept.push(token);
    used += token.weight;
  }

  // Prefer ending at whitespace if that drops at most ~30 weight of text.
  let end = kept.length;
  for (let i = kept.length - 1, dropped = 0; i > 0 && dropped <= 30; i--) {
    if (/^\s+$/u.test(kept[i].text)) {
      end = i;
      break;
    }
    dropped += kept[i].weight;
  }
  const body = kept
    .slice(0, end)
    .map((t) => t.text)
    .join("")
    .trimEnd();
  return `${body}${ELLIPSIS}`;
}
