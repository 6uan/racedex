import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TagResultSchema } from "@racedex/shared";
import { renderTagInput, type TagProvider } from "./provider";

export const ANTHROPIC_MODEL = "claude-haiku-4-5";

// Bump on any prompt or vocabulary change — tag_meta records it, so a re-tag
// can target only rows written by an older prompt.
export const PROMPT_VERSION = 1;

// The vocabulary is restated here (not generated from TAG_VALUES) on purpose:
// the definitions are the prompt, and the prompt must change only when this
// file changes, in lockstep with PROMPT_VERSION.
const SYSTEM = `You tag race listings for a directory of running races. From a listing's name, location, events, and description, return every tag that applies. Use only these tags:

- road: run on pavement — roads, streets, or paved paths
- trail: off-road running on trails, grass, sand, or mud
- track: held on a running track
- holiday: tied to a holiday (turkey trot, jingle bell run, New Year's, July 4th)
- charity: fundraising or a cause is central to the event
- themed: costume, color, glow, or another novelty theme is the draw
- kids: aimed at children or families (kids dash, family fun run)
- relay: a team relay format
- obstacle: obstacle course, mud run, or similar
- competitive: emphasizes timing, awards, records, or a certified course
- fun_run: explicitly untimed or participation-focused
- virtual: completed remotely or anywhere (virtual race or challenge)
- series: this listing is a multi-race series, not a single race
- not_a_run: not a running race (triathlon, bike ride, plane pull, stair climb, walk-only event, or a sponsorship/vendor page)

Rules:
- Only tag what the listing supports; if unsure, leave the tag out.
- Most ordinary races are road unless the listing says otherwise.
- virtual, series, and not_a_run combine with other tags when both are true.`;

export function createAnthropicProvider(): TagProvider {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — copy apps/api/.env.example to apps/api/.env and add a key",
    );
  }
  const client = new Anthropic();
  return {
    name: "anthropic",
    model: ANTHROPIC_MODEL,
    promptVersion: PROMPT_VERSION,
    async tagRace(input) {
      // Structured outputs constrain generation to the schema server-side;
      // parsed_output is the SDK's client-side parse (null when it fails).
      // The pipeline still validates the return value — same as any provider.
      const response = await client.messages.parse({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: renderTagInput(input) }],
        output_config: { format: zodOutputFormat(TagResultSchema) },
      });
      return response.parsed_output;
    },
  };
}
