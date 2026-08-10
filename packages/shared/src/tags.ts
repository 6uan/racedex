import { z } from "zod";

// The tag vocabulary — one closed enum, shared by every tagger provider and
// (eventually) the read API's filter params. Validation against this schema
// happens OUTSIDE providers (see PLAN.md): a provider returns whatever its
// model produced, and the pipeline accepts it only if it parses here. That
// shared gate is what makes providers interchangeable.
//
// `virtual` / `series` / `not_a_run` exist because the first ingest surfaced
// listings that aren't real local running races (step challenges, triathlons,
// plane pulls, sponsorship pages). The DB stays the unfiltered record;
// filtering happens at read time on these tags.
export const TAG_VALUES = [
  "road", // on pavement — roads, streets, paved paths
  "trail", // off-road: trails, grass, sand, mud
  "track", // held on a running track
  "holiday", // tied to a holiday (turkey trot, jingle bell, New Year's)
  "charity", // fundraising or a cause is central
  "themed", // costume / color / glow / novelty theme is the draw
  "kids", // aimed at children or families
  "relay", // team relay format
  "obstacle", // obstacle course or mud run
  "competitive", // emphasizes timing, awards, records, certified course
  "fun_run", // explicitly untimed or participation-focused
  "virtual", // completed remotely / anywhere
  "series", // listing is a multi-race series, not a single race
  "not_a_run", // not a running race at all
] as const;

export const TagSchema = z.enum(TAG_VALUES);
export type Tag = z.infer<typeof TagSchema>;

// Root must be an object for structured outputs; an extra wrapper also leaves
// room to grow (e.g. a confidence field) without re-shaping the column.
export const TagResultSchema = z.object({
  tags: z.array(TagSchema),
});
export type TagResult = z.infer<typeof TagResultSchema>;
