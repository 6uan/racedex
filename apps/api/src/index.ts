import express from "express";
import { APP_NAME } from "@racedex/shared";
import { migrationCount } from "./db/index";

const app = express();
// Default mirrors the port registry in infra's Caddyfile (racedex lane:
// web 3400, api 3401). API_PORT rather than PORT — see vite.config.ts.
const port = Number(process.env.API_PORT ?? 3401);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: APP_NAME, migrations: migrationCount() });
});

app.listen(port, () => {
  console.log(`${APP_NAME} api listening on http://localhost:${port}`);
});
