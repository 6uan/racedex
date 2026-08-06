import express from "express";
import { APP_NAME } from "@racedex/shared";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: APP_NAME });
});

app.listen(port, () => {
  console.log(`${APP_NAME} api listening on http://localhost:${port}`);
});
