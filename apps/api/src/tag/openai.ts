import { z } from "zod";
import { TagResultSchema } from "@racedex/shared";
import { SYSTEM } from "./prompt";
import { renderTagInput, type TagProvider } from "./provider";

// One OpenAI-compatible client covers OpenAI itself, the 3090 box over the
// tailnet (llama-swap/llama-server, Ollama), vLLM, and most other providers
// (#7). A single POST per race — plain fetch, no SDK dependency.
//
// Config: CLI flags (cli.ts) > TAGGER_MODEL / TAGGER_BASE_URL / TAGGER_API_KEY
// env vars > defaults. The default model is the promoted quality tagger:
// qwen3.6:27b scored F1 0.890 against an Opus 5 reference — above the
// deployed Haiku tagger's 0.851 (eval on the 3090 box, RESULTS.md).
export const DEFAULT_MODEL = "qwen3.6:27b";

// The same Zod object every provider validates against, emitted as JSON
// schema for engine-side constrained generation. Engines honour maxItems
// (carried by TagResultSchema) but ignore uniqueItems — dedupe stays in
// validate.ts. The $schema key is dropped: OpenAI's strict mode rejects
// unknown keywords, local engines just ignore it.
const { $schema: _, ...RESULT_JSON_SCHEMA } = z.toJSONSchema(TagResultSchema);

export function createOpenAICompatProvider(
  overrides: { model?: string; baseUrl?: string } = {},
): TagProvider {
  const baseUrl = overrides.baseUrl ?? process.env.TAGGER_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "TAGGER_BASE_URL is not set — copy apps/api/.env.example to apps/api/.env, or pass --base-url",
    );
  }
  const model = overrides.model ?? process.env.TAGGER_MODEL ?? DEFAULT_MODEL;
  // Optional: local endpoints are unauthenticated, OpenAI itself is not.
  const apiKey = process.env.TAGGER_API_KEY;

  return {
    name: "openai",
    model,
    async tagRace(input) {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: renderTagInput(input) },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "race_tags",
                strict: true,
                schema: RESULT_JSON_SCHEMA,
              },
            },
            // All eval measurements were taken at 0; keep runs reproducible.
            temperature: 0,
          }),
          // A model swap on the local box takes ~23s cold; p95 under load is
          // ~12s. Well past that the server is wedged — fail the race and let
          // the pipeline move on (the row stays untagged and retries next run).
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!response.ok) {
        throw new Error(
          `tagger endpoint ${response.status}: ${(await response.text()).slice(0, 200)}`,
        );
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      // No content at all (empty choices, a refusal) means the model never
      // answered — a transport failure, not a bad answer. Throw so the row
      // stays untagged and retries next run; returning it would fail the
      // schema gate and flag the race permanently (tag.ts).
      if (typeof content !== "string") {
        throw new Error(
          `tagger endpoint returned no message content: ${JSON.stringify(body).slice(0, 200)}`,
        );
      }
      // Malformed JSON (e.g. truncation) IS a model answer: return it raw so
      // the pipeline's schema gate flags the race.
      try {
        return JSON.parse(content);
      } catch {
        return content;
      }
    },
  };
}
