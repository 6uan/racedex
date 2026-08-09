// Explicit migration run: `pnpm --filter @racedex/api migrate`.
// Importing the db module applies pending migrations as a side effect; this
// just reports what happened.
import { appliedOnBoot, migrationCount } from "./index";

if (appliedOnBoot.length > 0) {
  console.log(`applied: ${appliedOnBoot.join(", ")}`);
} else {
  console.log("up to date — nothing to apply");
}
console.log(`${migrationCount()} migration(s) applied in total`);
