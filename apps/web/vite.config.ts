import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// racedex owns the 3400 lane: web on 3400, api on 3401. The authority for
// these numbers is the port registry in infra's Caddyfile — the
// racedex.ipsum.studio route proxies to exactly 3400, so the defaults here
// must agree with it. The env overrides exist for running outside that
// setup; they are distinct names (not both PORT) because `pnpm dev` runs
// web and api in one shared environment.
const WEB_PORT = Number(process.env.WEB_PORT ?? 3400);
const API_PORT = Number(process.env.API_PORT ?? 3401);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: WEB_PORT,
    // Fail loudly if the port is taken — Caddy proxies to this exact port,
    // and Vite's default hop to the next free one would 502 behind the
    // hostname while looking healthy locally.
    strictPort: true,
    allowedHosts: ["racedex.ipsum.studio"],
    proxy: {
      "/api": `http://localhost:${API_PORT}`,
      // Server-rendered debug page (apps/api/src/debug.ts). Proxied so it
      // shares the app's origin and works at racedex.ipsum.studio/debug.
      "/debug": `http://localhost:${API_PORT}`,
    },
  },
});
