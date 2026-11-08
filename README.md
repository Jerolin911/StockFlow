# StockFlow

Inventory, procurement, warehouse operations and order fulfilment for a single business with multiple warehouses. MERN stack with TypeScript throughout.

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Progress: [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md)

## Repository layout

| Path              | Contents                                                        |
| ----------------- | --------------------------------------------------------------- |
| `apps/api`        | Express + Mongoose API                                          |
| `apps/web`        | React + Vite frontend (Tailwind CSS, shadcn/ui, TanStack Query) |
| `packages/shared` | Roles, permissions, Zod schemas and API types used by both      |

## Local development

Requires Node.js 20.19 or later (22 LTS recommended).

```bash
npm install
cp apps/api/.env.example apps/api/.env   # then set JWT_ACCESS_SECRET
```

MongoDB must run as a replica set. Either start one with Docker:

```bash
docker compose up -d mongo
```

or run a local one without Docker (downloads a MongoDB binary on first run, stores data in `apps/api/.data`):

```bash
npm run db:local
```

Then seed demo users and start the API (port 4000) and web app (port 5173):

```bash
npm run seed
npm run dev
```

Open http://localhost:5173. Seeded accounts, one per role:

| Role                | Email                        |
| ------------------- | ---------------------------- |
| Admin               | `admin@stockflow.test`       |
| Inventory Manager   | `inventory@stockflow.test`   |
| Procurement Manager | `procurement@stockflow.test` |
| Sales Manager       | `sales@stockflow.test`       |
| Staff               | `staff@stockflow.test`       |

The demo password is `DEMO_PASSWORD` in [apps/api/scripts/seed-data.ts](apps/api/scripts/seed-data.ts), or `SEED_PASSWORD` if you set it.

`npm run seed` drops the development database and creates three warehouses, five categories, 19 products, suppliers and customers, and posts opening stock plus one adjustment through the same services the API uses, so the movement ledger is consistent. Seed data is for demonstration only and the script refuses to run with `NODE_ENV=production`.

## Inventory rules

- Every change to a stock quantity writes a movement in the same MongoDB transaction; the ledger always sums to on-hand.
- Available = on hand − reserved. Withdrawals can't take available stock below zero, even under concurrent requests.
- Opening stock can be registered once per product per warehouse, before any other movement there. Later corrections are adjustments.
- Low stock: available ≤ threshold in a warehouse that holds the product. The threshold is the product's, or a per-warehouse override.
- Leaving the SKU blank generates `<category code>-00001`; SKUs can't be changed afterwards.

## Checks

```bash
npm run lint
npm run typecheck
npm test            # shared unit, API integration (in-memory MongoDB replica set), web unit
npm run test:e2e    # Playwright; starts its own API and web servers
```

Install the Playwright browser once with `npx playwright install chromium` from `apps/web`.

## Docker

```bash
cp .env.example .env   # set JWT_ACCESS_SECRET and the bootstrap admin
docker compose up --build
```

The web app is served on http://localhost:8080 with `/api` proxied to the API. The bootstrap admin is created on an empty database and must change the password at first sign-in.
