import { TAG_VALUES, TagResultSchema, type Tag } from "@racedex/shared";
import type { TagInput, TagProvider } from "./provider";

// The validation gate that sits OUTSIDE every provider (PLAN.md): a response
// counts only if it parses against the shared schema. Schema-invalid answers
// get one retry, then the caller flags the race. Kept free of DB imports so
// it tests as a pure module.

export type TagOutcome =
  | { status: "tagged"; tags: Tag[]; attempts: number }
  | { status: "invalid"; attempts: number };

const MAX_ATTEMPTS = 2;

export async function tagWithRetry(
  provider: TagProvider,
  input: TagInput,
): Promise<TagOutcome> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await provider.tagRace(input);
    const parsed = TagResultSchema.safeParse(raw);
    if (parsed.success) {
      return {
        status: "tagged",
        tags: normalize(parsed.data.tags),
        attempts: attempt,
      };
    }
  }
  return { status: "invalid", attempts: MAX_ATTEMPTS };
}

// Dedupe and order by vocabulary position so identical tag sets always
// serialize to identical JSON — diffable across re-tags.
function normalize(tags: Tag[]): Tag[] {
  return [...new Set(tags)].sort(
    (a, b) => TAG_VALUES.indexOf(a) - TAG_VALUES.indexOf(b),
  );
}
