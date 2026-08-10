import { db } from "../db/index";
import type { TagInput, TagProvider } from "./provider";
import { tagWithRetry, type TagOutcome } from "./validate";

// The tagging pipeline runner (issue #6). Selects untagged races, asks the
// provider, validates via tagWithRetry, and records tags + provenance.
// Provider/network errors leave the row untouched (tag_meta stays NULL), so
// the next run retries those races; the run itself never crashes.

export type Candidate = TagInput & { id: string };

// Untagged = tag_meta IS NULL. Flagged rows (tag_meta carries an error) are
// deliberately not re-selected — re-tagging those is a manual decision.
const candidatesStmt = db.prepare(`
  SELECT
    r.id, r.name, r.city, r.state, r.description_text,
    (SELECT GROUP_CONCAT(e.name, ' | ') FROM events e WHERE e.race_id = r.id)
      AS event_names
  FROM races r
  WHERE r.tag_meta IS NULL
  ORDER BY r.id
  LIMIT ?
`);

type CandidateRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  description_text: string | null;
  event_names: string | null;
};

export function selectCandidates(limit?: number): Candidate[] {
  const rows = candidatesStmt.all(limit ?? -1) as CandidateRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    state: r.state,
    eventNames: r.event_names ? r.event_names.split(" | ") : [],
    description: r.description_text,
  }));
}

const updateStmt = db.prepare(
  "UPDATE races SET tags = ?, tag_meta = ? WHERE id = ?",
);

const untaggedCountStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM races WHERE tag_meta IS NULL",
);

export type TagSummary = {
  candidates: number;
  tagged: number;
  retried: number;
  flagged: number;
  errors: number;
  remaining: number;
};

export async function runTag(
  provider: TagProvider,
  { limit }: { limit?: number } = {},
): Promise<TagSummary> {
  const candidates = selectCandidates(limit);
  const summary: TagSummary = {
    candidates: candidates.length,
    tagged: 0,
    retried: 0,
    flagged: 0,
    errors: 0,
    remaining: 0,
  };

  for (const { id, ...input } of candidates) {
    const meta = {
      provider: provider.name,
      model: provider.model,
      prompt_version: provider.promptVersion,
      tagged_at: new Date().toISOString(),
    };
    let outcome: TagOutcome;
    try {
      outcome = await tagWithRetry(provider, input);
    } catch (err) {
      // Provider/network failure after the SDK's own retries: leave the row
      // untagged and keep going — the run must never crash (acceptance, #6).
      summary.errors++;
      console.error(`✗ ${id} ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (outcome.status === "tagged") {
      updateStmt.run(JSON.stringify(outcome.tags), JSON.stringify(meta), id);
      summary.tagged++;
      if (outcome.attempts > 1) summary.retried++;
      console.log(`✓ ${id} ${outcome.tags.join(", ") || "(no tags)"}`);
    } else {
      updateStmt.run(
        null,
        JSON.stringify({ ...meta, error: "schema_invalid" }),
        id,
      );
      summary.flagged++;
      console.log(`! ${id} schema-invalid after ${outcome.attempts} attempts`);
    }
  }

  summary.remaining = (untaggedCountStmt.get() as { n: number }).n;
  return summary;
}
