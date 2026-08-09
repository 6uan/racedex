# racedex

A race directory for South Florida runners — weather history, course intel, and
competitiveness scores for every local race. See [GOAL.md](./GOAL.md) for the
full project plan.

## Structure

```
apps/api/        Express API + data pipeline (better-sqlite3)
apps/web/        React + Tailwind frontend (Vite)
packages/shared/ Types shared between api and web
```

## Development

Requires Node >= 22 and pnpm.

```sh
pnpm install
pnpm dev        # api on :3401 and web on :3400 (proxies /api to the api)
pnpm typecheck  # typecheck all packages
```

Ports default to racedex's lane in the dev box's Caddy port registry
(web 3400, api 3401). Override with `WEB_PORT` / `API_PORT` to run elsewhere.
