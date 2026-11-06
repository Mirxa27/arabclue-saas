/**
 * LinkedIn versioned REST API (https://api.linkedin.com/rest) — the one place the version lives.
 *
 * LinkedIn's versioning page (https://learn.microsoft.com/en-us/linkedin/marketing/versioning,
 * read 2026-11-06) lists 202610 (October 2026) as the latest version; versions are "supported
 * and stable for a minimum of one year before sunset", 202511 sunsets on November 16, 2026, and
 * a deprecated version header is answered with 426 NONEXISTENT_VERSION. Every call must send
 * `Linkedin-Version` and `X-Restli-Protocol-Version: 2.0.0`.
 * __tests__/social/linkedin-api.test.ts fails once this version is ~11 months old — bump it then.
 */

export const LINKEDIN_API_VERSION = "202610";
export const LINKEDIN_REST_BASE = "https://api.linkedin.com/rest";

/** Posts API `commentary` limit (characters). */
export const LINKEDIN_COMMENTARY_MAX = 3000;

export function linkedInRestHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "Linkedin-Version": LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0"
  };
}

// little text format (…/community-management/shares/little-text-format): these characters are
// reserved and "need to be escaped with a backslash, even if those characters are not used in
// one of the supported elements or templates". Unescaped, LinkedIn truncates or mangles the post.
const RESERVED = new Set(["|", "{", "}", "@", "[", "]", "(", ")", "<", ">", "#", "\\", "*", "_", "~"]);
// A hashtag element is '#' followed by a single word (letters, marks, digits — Arabic included);
// those '#'s stay unescaped so the hashtag still links. '_' is reserved, so it ends the word.
const HASHTAG_RE = /#[\p{L}\p{M}\p{N}]+/uy;

/** Plain caption → little-format commentary: hashtags stay hashtags, everything else is literal. */
export function toLittleText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === "#") {
      HASHTAG_RE.lastIndex = i;
      const tag = HASHTAG_RE.exec(text);
      if (tag) {
        out += tag[0];
        i += tag[0].length;
        continue;
      }
    }
    const ch = text[i];
    out += RESERVED.has(ch) ? `\\${ch}` : ch;
    i += 1;
  }
  return out;
}
