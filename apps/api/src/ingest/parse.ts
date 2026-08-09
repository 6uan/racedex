// Scalar parsers for RunSignup's string-heavy JSON. All of them return null
// for anything they can't parse — the schema's honest no-data state — rather
// than guessing.

// "10/17/2026" → "2026-10-17"
export function usDateToIso(us: string | null | undefined): string | null {
  const m = us?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

// "10/17/2026 07:30" → { date: "2026-10-17", time: "07:30" }
export function usDateTimeParts(
  us: string | null | undefined,
): { date: string; time: string } | null {
  const m = us?.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const date = usDateToIso(m[1]);
  if (!date) return null;
  return { date, time: `${m[2]!.padStart(2, "0")}:${m[3]}` };
}

// "7/27/2026 10:00" → "2026-07-27T10:00" (local time, no offset — consistent
// with the schema's ISO TEXT convention; everything here is race-local).
export function usDateTimeToIso(us: string | null | undefined): string | null {
  const parts = usDateTimeParts(us);
  return parts ? `${parts.date}T${parts.time}` : null;
}

// "$15.00" → 1500, "$1,250.50" → 125050
export function moneyToCents(money: string | null | undefined): number | null {
  const m = money?.match(/^\s*\$?([\d,]+(?:\.\d{1,2})?)\s*$/);
  if (!m) return null;
  const dollars = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

// Finish times: "18:30.02" (MM:SS.ff) or "1:02:33" (H:MM:SS) → whole seconds.
export function durationToSeconds(
  duration: string | null | undefined,
): number | null {
  if (!duration) return null;
  const parts = duration.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [a, b, c] = nums;
  const seconds =
    parts.length === 2 ? a! * 60 + b! : a! * 3600 + b! * 60 + c!;
  return Math.round(seconds);
}

// Good-enough HTML → text for tagger input and display. Block-level closers
// become newlines so paragraphs survive; entities beyond the common named set
// are decoded numerically or dropped.
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return text || null;
}
