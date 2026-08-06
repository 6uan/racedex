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
pnpm --filter @racedex/api dev   # API on :3001
pnpm --filter @racedex/web dev   # Vite dev server, proxies /api to :3001
pnpm typecheck                   # typecheck all packages
```
