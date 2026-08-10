import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// pnpm --filter @racedex/api tag [-- --provider anthropic --limit 5 --dry-run]
//
// --dry-run lists the races that would be tagged and a rough cost estimate
// without touching the network or the DB. --limit N tags only the first N
// untagged races. Flagged races (schema-invalid) are skipped on later runs.

// First secret in the project (ANTHROPIC_API_KEY): loaded with Node's native
// env-file support — no dotenv dependency (PLAN.md). Vars already present in
// the environment win; a missing .env is fine if the var is exported.
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
try {
  process.loadEnvFile(path.join(packageRoot, ".env"));
} catch {
  // no .env file — the key may be in the environment already
}

const { values } = parseArgs({
  // pnpm forwards a literal "--" separator; drop it so flags after it parse.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    provider: { type: "string", default: "anthropic" },
    limit: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const limit = values.limit === undefined ? undefined : Number(values.limit);

if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  console.error("usage: tag [--provider anthropic] [--limit N] [--dry-run]");
  process.exit(1);
}

// Imported after loadEnvFile on principle, though providers only read env
// when constructed. Registry grows with the OpenAI-compatible provider (#7).
const { selectCandidates, runTag } = await import("./tag");
const { createAnthropicProvider } = await import("./anthropic");

const providers: Record<string, () => import("./provider").TagProvider> = {
  anthropic: createAnthropicProvider,
};

const createProvider = providers[values.provider];
if (!createProvider) {
  console.error(
    `unknown provider '${values.provider}' (known: ${Object.keys(providers).join(", ")})`,
  );
  process.exit(1);
}

if (values["dry-run"]) {
  const candidates = selectCandidates(limit);
  for (const c of candidates) {
    console.log(
      `${c.id}  ${c.name}  (${c.eventNames.length} events, ${c.description?.length ?? 0} desc chars)`,
    );
  }
  // ~4 chars/token, ~450-token system prompt per request, ~30 output tokens.
  // Haiku 4.5: $1/MTok in, $5/MTok out — sanity check, not an invoice.
  const inputChars = candidates.reduce(
    (sum, c) => sum + c.name.length + (c.description?.length ?? 0) + 100,
    0,
  );
  const inTokens = Math.round(inputChars / 4) + candidates.length * 450;
  const cents = (inTokens / 1e6) * 100 + ((candidates.length * 30) / 1e6) * 500;
  console.log(
    `\ndry run: ${candidates.length} races would be tagged (~${inTokens.toLocaleString()} input tokens ≈ $${(cents / 100).toFixed(2)})`,
  );
  process.exit(0);
}

const startedAt = Date.now();
const summary = await runTag(createProvider(), { limit });

console.log(`
tag finished in ${Math.round((Date.now() - startedAt) / 1000)}s
  candidates  ${summary.candidates}
  tagged      ${summary.tagged} (${summary.retried} needed a retry)
  flagged     ${summary.flagged} schema-invalid
  errors      ${summary.errors} (left untagged, retried next run)
  remaining   ${summary.remaining} untagged`);
