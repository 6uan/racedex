// The provider seam for the tagging step (issue #6). A provider knows how to
// ask one model for tags; it does NOT validate the answer — the pipeline in
// tag.ts parses every response against TagResultSchema from @racedex/shared,
// which is what keeps providers interchangeable (PLAN.md).

export type TagInput = {
  name: string;
  city: string | null;
  state: string | null;
  /** Event names as listed by the source, e.g. "5K Run/Walk". */
  eventNames: string[];
  /** HTML already stripped at ingest (races.description_text). */
  description: string | null;
};

export type TagProvider = {
  /** Provenance, recorded per race in races.tag_meta. */
  name: string;
  model: string;
  promptVersion: number;
  /** Raw model output — the caller validates it, never the provider. */
  tagRace(input: TagInput): Promise<unknown>;
};

export function renderTagInput(input: TagInput): string {
  const place = [input.city, input.state].filter(Boolean).join(", ");
  return [
    `Race: ${input.name}`,
    `Location: ${place || "(unknown)"}`,
    `Events: ${input.eventNames.join(" | ") || "(none listed)"}`,
    `Description:`,
    input.description ?? "(no description)",
  ].join("\n");
}
