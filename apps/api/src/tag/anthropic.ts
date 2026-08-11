import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TagResultSchema } from "@racedex/shared";
import { SYSTEM } from "./prompt";
import { renderTagInput, type TagProvider } from "./provider";

export const ANTHROPIC_MODEL = "claude-haiku-4-5";

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
