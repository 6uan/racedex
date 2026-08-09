// Free-text distance → meters. Ordered pattern table, first match wins;
// nothing matches → null. Never guess: a bare number ("Race #2") or an
// ambiguous unit (see the mile/meter rule below) stays null.

const MILE_M = 1609.344;

type Pattern = {
  re: RegExp;
  toMeters: (match: RegExpMatchArray) => number | null;
};

const PATTERNS: Pattern[] = [
  // Cultural constants first — "13.1" must not fall through to a bare-number
  // rule, and "half marathon" must win before "marathon" can match inside it.
  { re: /\bhalf\s*-?\s*marathon\b|\b13\.1\b/i, toMeters: () => 21097 },
  { re: /\bmarathon\b|\b26\.2\b/i, toMeters: () => 42195 },
  { re: /\b3\.1\b/, toMeters: () => 5000 },
  { re: /\b6\.2\b/, toMeters: () => 10000 },

  // "5K", "3.5k", "10 km", "50K"
  {
    re: /(\d+(?:\.\d+)?)\s*k(?:m)?\b/i,
    toMeters: (m) => Math.round(Number(m[1]) * 1000),
  },
  // "10 Mile", "1 mile", "100-Miler", "13.1 miles"
  {
    re: /(\d+(?:\.\d+)?)[\s-]*(?:miles?|miler)\b/i,
    toMeters: (m) => Math.round(Number(m[1]) * MILE_M),
  },
  // "400m", "800 meters". Bare "m" under 100 is ambiguous — race names use
  // "1M" for one mile — so it stays null; spelled-out "meters" always counts.
  {
    re: /(\d+(?:\.\d+)?)\s*meters?\b/i,
    toMeters: (m) => Math.round(Number(m[1])),
  },
  {
    re: /(\d+(?:\.\d+)?)\s*m\b/i,
    toMeters: (m) => {
      const n = Number(m[1]);
      return n >= 100 ? Math.round(n) : null;
    },
  },
  // "Mile" with no number ("Magic Mile") — one mile by convention.
  { re: /\bmile\b/i, toMeters: () => Math.round(MILE_M) },
];

// Tries each candidate string (e.g. the API's `distance` field first, then the
// event name) against the table; the first hit anywhere wins.
export function parseDistanceMeters(
  ...candidates: (string | null | undefined)[]
): number | null {
  for (const text of candidates) {
    if (!text) continue;
    for (const { re, toMeters } of PATTERNS) {
      const match = text.match(re);
      if (match) {
        const meters = toMeters(match);
        if (meters !== null) return meters;
      }
    }
  }
  return null;
}
