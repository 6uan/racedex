import express from "express";
import { APP_NAME } from "@racedex/shared";
import { migrationCount } from "./db/index";
import { debugPage } from "./debug";
import { raceDetail, raceList } from "./read/races";

const app = express();
// Default mirrors the port registry in infra's Caddyfile (racedex lane:
// web 3400, api 3401). API_PORT rather than PORT — see vite.config.ts.
const port = Number(process.env.API_PORT ?? 3401);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: APP_NAME, migrations: migrationCount() });
});

// The public read surface (issue #9) — read-only, no auth, no token. The
// detail route matches any single segment and resolves on its trailing ID,
// so a renamed race redirects rather than 404s.
app.get("/api/races", raceList);
app.get("/api/races/:segment", raceDetail);

// Interim visibility into the pipeline DB — see src/debug.ts. Deliberately
// outside /api: it's a page, not an endpoint, and it disappears with the
// final polish issue.
app.get("/debug", debugPage);

app.listen(port, () => {
  console.log(`${APP_NAME} api listening on http://localhost:${port}`);
});
