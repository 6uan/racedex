import { db } from "../db/index";
import type { FetchCacheRow } from "../db/rows";

// Modest politeness: at most ~3 requests/second against RunSignup. Cold runs
// take a few minutes; warm runs never wait because they never hit the network.
const POLITENESS_MS = 350;
const FETCH_RETRIES = 2;

export type Fetched = {
  status: number;
  body: string;
  fromCache: boolean;
};

// Cache-first HTTP over fetch_cache. The newest cached response for a URL is
// served if younger than maxAgeHours; anything older triggers a real fetch,
// which is appended (never overwritten — fetch_cache is the historical record).
// Non-200 responses are cached and count as fresh too, so a URL that 404s
// isn't hammered on every run; parsers treat them as "no data".
export class CachedFetcher {
  networkFetches = 0;
  cacheHits = 0;
  failedFetches = 0;

  private readonly maxAgeMs: number;
  private lastNetworkAt = 0;

  private readonly selectNewest = db.prepare(
    `SELECT status, body, fetched_at FROM fetch_cache
     WHERE url = ? ORDER BY fetched_at DESC LIMIT 1`,
  );
  private readonly insert = db.prepare(
    "INSERT INTO fetch_cache (url, fetched_at, status, body) VALUES (?, ?, ?, ?)",
  );

  constructor(maxAgeHours: number) {
    this.maxAgeMs = maxAgeHours * 3_600_000;
  }

  async get(url: string): Promise<Fetched> {
    const cached = this.selectNewest.get(url) as
      | Pick<FetchCacheRow, "status" | "body" | "fetched_at">
      | undefined;
    if (cached && Date.now() - Date.parse(cached.fetched_at) < this.maxAgeMs) {
      this.cacheHits += 1;
      return { status: cached.status, body: cached.body, fromCache: true };
    }

    // Cold runs last minutes; a transient connect timeout must not kill the
    // whole pipeline. Retry with backoff, then report status 0 ("no data" to
    // every parser) without caching — the next run retries it for free.
    for (let attempt = 1; ; attempt++) {
      const wait = this.lastNetworkAt + POLITENESS_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastNetworkAt = Date.now();

      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "racedex-ingest/0.1 (personal project)" },
        });
        const body = await res.text();
        this.insert.run(url, new Date().toISOString(), res.status, body);
        this.networkFetches += 1;
        return { status: res.status, body, fromCache: false };
      } catch (error) {
        if (attempt > FETCH_RETRIES) {
          console.error(`fetch failed (${attempt} attempts): ${url}`, error);
          this.failedFetches += 1;
          return { status: 0, body: "", fromCache: false };
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }
  }

  // JSON convenience: null on non-200 or a body that doesn't parse, so callers
  // can treat every failure mode as "no data" without try/catch at each site.
  async getJson<T>(url: string): Promise<T | null> {
    const { status, body } = await this.get(url);
    if (status !== 200) return null;
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }
}
