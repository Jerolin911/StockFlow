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

`npm run seed` drops the development database and creates three warehouses, five categories, 19 products, suppliers and customers. It then posts opening stock, an adjustment, purchase orders with receipts, sales orders at every fulfilment stage (delivered, partly shipped, picking, packed, waiting, draft, cancelled), transfers (received, in transit, awaiting approval), a customer return awaiting inspection, quarantined stock with an approved supplier return, and a count in progress, all through the same services the API uses, so stock levels, reservations and the movement ledger agree. Seed data is for demonstration only and the script refuses to run with `NODE_ENV=production`.

## Inventory rules

- Every change to a stock quantity writes a movement in the same MongoDB transaction; the ledger always sums to on-hand.
- Available = on hand − reserved. Withdrawals can't take available stock below zero, even under concurrent requests.
- Opening stock can be registered once per product per warehouse, before any other movement there. Later corrections are adjustments.
- Low stock: available ≤ threshold in a warehouse that holds the product. The threshold is the product's, or a per-warehouse override.
- Leaving the SKU blank generates `<category code>-00001`; SKUs can't be changed afterwards.

## Procurement rules

- Purchase requests → approval → purchase order for a chosen supplier → approval → goods receipts. Nobody approves their own request or order unless they're an admin.
- Order lines default to the supplier's price list, else the product's cost price; the expected date defaults from the supplier's lead time.
- Each goods receipt line records accepted, rejected and damaged quantities. Only accepted units enter stock. Outstanding = ordered − accepted, so rejected and damaged units remain outstanding.
- Orders can be cancelled until the first receipt; after that, "close remaining" ends what's outstanding.
- No invoices or payments are handled; order totals are informational.

## Fulfilment rules

- Sales order lines default to the product's selling price, with an optional per-line discount; tax is applied after the discount.
- Confirming an order reserves every line in its warehouse, all or nothing. It's refused with the short lines listed when available stock (on hand − reserved) isn't enough; there are no backorders. Concurrent confirmations can't reserve the same units.
- Warehouse staff create pick lists for some or all of an order, confirm what was picked (short picks need a reason and return the units to the order, still reserved), record packing, then dispatch.
- On-hand stock falls only at dispatch, together with the reservation, as a `SHIPMENT` movement at the current average cost. Picking and packing don't change stock.
- After dispatch, tracking updates (in transit, out for delivery, failed attempt, delivered with the recipient's name) build the delivery timeline. The order is delivered when everything shipped has been delivered.
- Cancelling an order releases all unshipped reservations and cancels open pick lists. After a partial shipment, only the remainder is cancelled.

## Warehouse operations and returns

- **Transfers:** requested, approved by someone other than the requester, then dispatched (stock leaves the source and is in transit, in neither warehouse). Receipts can be partial; damaged units go to the destination's quarantine. What never arrives is closed short: recorded at the destination and written off as a loss.
- **Physical counts:** a count sheet covers every active product held in a warehouse, or one category; counting is blind by default. Variances are measured against on-hand when posting and each needs a reason (damaged, lost, found or miscount). Posting creates one adjustment. A count can't go below reserved stock.
- **Quarantine:** a second balance per warehouse for damaged goods and returns awaiting inspection. It's never available to sell; units leave by release, write-off or a supplier return.
- **Customer returns:** raised against shipped quantities, approved, received into quarantine, then inspected: restocked units become usable at the cost they shipped at; the rest stay isolated.
- **Supplier returns:** from quarantine or usable stock, approved by procurement, then sent; stock leaves at dispatch.
- **Corrections:** movements are never deleted. A posted adjustment is reversed by a new adjustment with the opposite quantities, linked both ways.

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
