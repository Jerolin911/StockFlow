# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

StockFlow is an inventory, procurement, warehouse operations and order fulfilment system for one business with multiple users and warehouses. It's an npm-workspaces monorepo: `apps/api` (Express 5 + Mongoose), `apps/web` (React + Vite + Tailwind + shadcn/ui + TanStack Query), `packages/shared` (roles, permissions, Zod schemas, DTO types, money helpers used by both).

- `docs/ARCHITECTURE.md` is the design source of truth: workflows, data model, invariants, endpoints, key decisions, roadmap. Keep it in sync when behaviour changes.
- `IMPLEMENTATION_LOG.md` gets an entry per phase: completed work, fixed issues, changed files, test results, pending issues. Commit after each completed phase.

## Scope rules

- Out of scope: invoices (supplier or customer), payment records, payment status, reimbursements, payment gateways, OAuth or external identity providers, multiple tenants, returns, backorders. Order prices and totals are informational only.
- No mock functionality, placeholders, TODOs or fabricated metrics. Business logic lives on the backend; the frontend uses the shared schemas for previews only, and the server recalculates.

## Commands

Run from the repo root unless noted. Node ≥ 20.19.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # set JWT_ACCESS_SECRET (≥32 chars)
npm run db:local        # local MongoDB replica set rs0 on 27017 (no Docker); or: docker compose up -d mongo
npm run seed            # drops the dev DB and seeds demo data through the real services
npm run dev             # API on :4000 (tsx watch) + web on :5173 (Vite proxies /api)

npm run lint            # eslint .
npm run typecheck       # all workspaces
npm run format:check    # prettier (npm run format to fix)
npm run build           # shared → api → web, in that order
npm test                # Vitest in every workspace
npm run test:e2e        # Playwright; starts its own seeded in-memory API (:4100) and Vite (:5174)
```

Single tests:

```bash
cd apps/api && npx vitest run tests/sales.test.ts
cd apps/api && npx vitest run tests/sales.test.ts -t "concurrent"
cd packages/shared && npx vitest run src/money.test.ts
cd apps/web && npx playwright test e2e/sales.spec.ts
```

Install the Playwright browser once with `npx playwright install chromium` from `apps/web`. Seeded accounts are `<role>@stockflow.test` (admin, inventory, procurement, sales, staff); the password is `DEMO_PASSWORD` in `apps/api/scripts/seed-data.ts`, or `SEED_PASSWORD` if set.

## Architecture

### Shared package

`@stockflow/shared` resolves to `packages/shared/src/index.ts` in dev and tests (tsconfig `paths`, Vite/Vitest aliases) and to `dist` in production builds. Statuses, labels, permission strings, the role → permission map, request schemas and DTO interfaces all live here, so changing a status or field means changing shared first. `ROLE_PERMISSIONS` drives both `authorize()` on the API and what the web UI shows.

Zod gotcha: field helpers and update schemas have no `.default()`, because Zod 4 applies defaults inside `.partial()` and would overwrite stored values on PATCH. Create schemas add defaults explicitly.

### API (`apps/api/src`)

- `app.ts` mounts feature routers under `/api/v1`. Nested routers (`/products/:productId/supplier-prices`, `/suppliers/:supplierId`) are mounted before their parent routers.
- Modules live in `modules/<feature>/`. Handlers parse input with shared Zod schemas and throw `AppError` (`lib/errors.ts`); the central `middleware/error-handler.ts` maps ZodError to 400 `VALIDATION_ERROR` with `details: [{path, message}]`, duplicate keys to 409 `CONFLICT`, and so on. Error `path`s like `lines.2.quantity` are mapped back onto form fields by the web app.
- Auth: a 15-minute HS256 access token held in memory by the client, plus a rotating opaque refresh token stored hashed in `sessions` and sent as the httpOnly cookie `sf_refresh` (path `/api/v1/auth`). `authenticate()` reloads the user on every request. `mustChangePassword` blocks everything else with `PASSWORD_CHANGE_REQUIRED`.
- `modules/common/documents.ts` has the document helpers (actor snapshots, history entries, date helpers, active-entity loaders, warehouse lookup); `modules/common/schemas.ts` has the shared Mongoose sub-schemas.
- Documents embed line items and snapshot names (customer, supplier, product SKU and name, user) so history reads correctly after renames. Numbers come from `nextDocumentNumber(prefix, session)` (`PREFIX-YYYY-00001`), called inside the posting transaction.
- Money is integer minor units, rates are basis points, quantities are integers.

### Inventory consistency (the core invariant)

- `stockLevels` holds current `onHand`/`reserved` per product × warehouse; `stockMovements` is an append-only ledger. Only `modules/stock/stock.service.ts` writes quantities:
  - `applyMovement` changes on-hand. Withdrawals use a conditional filter (`onHand − reserved ≥ q`); `fromReserved: true` lowers on-hand and reserved together.
  - `reserveStock` and `releaseReservation` change only `reserved`.
- Every stock change writes a movement in the same transaction. Wrap postings in `inTransaction()` (`lib/transaction.ts`), which retries write conflicts and duplicate-key insert races. Guards are conditional updates, never read-then-write, so concurrent requests can't oversell.
- Procurement (`modules/purchasing`): stock increases only by accepted GRN quantities; outstanding = ordered − accepted.
- Fulfilment (`modules/sales`): confirmation reserves every line, all or nothing. Pick lists allocate units on order lines without moving stock. On-hand falls only at dispatch, as `SHIPMENT` movements at average cost. Cancellation releases unshipped reservations.
- `apps/api/tests/fixtures.ts` `expectLedgerConsistent()` runs after every stock-touching test (in `afterEach`). It checks ledger = on-hand, reserved = what open orders hold, order-line counters = their shipments, and `SHIPMENT` movements = what was dispatched. Never set `onHand`/`reserved` directly in tests; go through the API or services.

### Tests

- API tests use Supertest against `createApp()` with a `mongodb-memory-server` replica set. The global setup provides the URI, each file gets its own database, and collections are cleared before each test. Helpers: `tokenFor(app, role)`, `api(app, token)`, and fixture creators in `tests/fixtures.ts`.
- Concurrency tests fire parallel requests and assert exactly-N successes. Rerun a suite a few times after touching transactional code.
- E2E (`apps/web/e2e`) runs serially with one worker against one seeded database, so specs see each other's changes. Read before/after values within a test instead of hard-coding stock figures. Assert statuses via the badge next to the `h1` (status words also appear in table headers, history and progress strips).
- The seed test (`tests/seed.test.ts`) pins counts such as 5 low-stock combinations and the per-status sales orders; update it when seed data changes.

### Web (`apps/web/src`)

- `features/<feature>/` holds pages plus an `api.ts` of TanStack Query hooks built on `lib/query.ts` (`useListQuery`, `useDetailQuery`, `useApiMutation`, which invalidates the given resource keys; stock-changing mutations also invalidate `STOCK_RESOURCES`).
- Routes are in `app/router.tsx`; write pages are wrapped in `RequirePermission`. The sidebar is in `app/navigation.ts`.
- List filters live in the URL (`lib/use-url-filters.ts`).
- Dialog forms render inside `FormDialog` (`components/form-parts.tsx`) so state resets on each open; this avoids set-state-in-effect lint errors.
- Shared document UI is in `components/document-parts.tsx` (`History`, `ReasonDialog`). New history action names need a label in its `ACTION_LABELS`.
- `lib/api-client.ts` refreshes once on 401 and turns errors into `ApiError { status, code, message, details }`.
- shadcn components are in `components/ui`. If the shadcn CLI adds an import of `cn` from an npm package, repoint it to `@/lib/utils`.

## Environment notes

- MongoDB must run as a replica set (transactions).
- The root `package.json` overrides `vite` to `^7.3.7`; Vitest 4 would otherwise pull in Vite 8.
- Docker (`docker-compose.yml`: mongo replica set, api, nginx web on :8080) and CI (`.github/workflows/ci.yml`) exist but haven't been run in this environment yet.
