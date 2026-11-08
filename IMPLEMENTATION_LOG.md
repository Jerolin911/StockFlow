# Implementation Log

## Phase 0 — Architecture (2026-11-08)

### Completed

- Architecture document covering requirements and roles, workflows, MongoDB data model and indexes, inventory calculations and consistency rules, authentication and RBAC, API endpoints, frontend structure, folder layout, testing and infrastructure, key decisions, and the implementation roadmap.
- Repository initialised.

### Changed files

- `docs/ARCHITECTURE.md` (new)
- `IMPLEMENTATION_LOG.md` (new)
- `.gitignore` (new)

### Verification

- All 10 Mermaid diagrams in `docs/ARCHITECTURE.md` render without errors with Mermaid 11.4.1.
- No application code yet, so there are no automated tests.

### Scope revision

- At the user's request, invoicing and payments were removed from scope, overriding the earlier project instruction to build them. Removed: supplier and customer invoices, payment records, payment status tracking, reimbursement workflows and payment gateways. The focus is now inventory, procurement, warehouse operations and order fulfilment.
- Architecture changes:
  - Removed the `supplierInvoices`, `customerInvoices` and `payments` collections and the invoiced-quantity fields on order lines.
  - Removed the Accountant role, leaving five roles.
  - Replaced the financial reports (aging) with purchasing summary, fulfilment summary and stock turnover reports.
  - Added a stock-transfer state diagram.
  - Dropped the invoices and payments phase from the roadmap, leaving phases 0–8.
- All 10 Mermaid diagrams render again without errors with Mermaid 11.4.1.

### Pending issues

- None. Phase 1 (Foundation) is next.

## Phase 1 — Foundation, authentication and user management (2026-11-08)

### Completed

- **Roles:** replaced the role set with Admin, Inventory Manager, Procurement Manager, Sales Manager and Staff, and updated the permission matrix in the architecture document. Merged the old phases 1 and 2 into this phase, and moved workspace settings and the audit log to Phase 2.
- **Monorepo:** npm workspaces (`apps/api`, `apps/web`, `packages/shared`) with TypeScript 5.9, ESLint 9, Prettier and Vitest 4. Vite is pinned to 7 through an npm override, because Vitest 4 otherwise pulls in Vite 8 and breaks the React plugin. Node 20.19 is supported; Vitest 5 and React Router 8 need Node 22, so they're not used yet.
- **Shared package:** roles, the permission map with labels, Zod schemas (login, change password, create/update/list users, reset password), error codes and API types.
- **API:**
  - Zod-validated environment config.
  - pino logging with request IDs and redaction of secrets.
  - helmet, CORS allowlist and a 100 kb JSON limit.
  - Central error handler that maps Zod errors, malformed JSON, oversized bodies, duplicate keys and `AppError` to a single JSON error format.
  - `/health` with a database ping.
  - Graceful shutdown.
- **Auth:**
  - bcrypt (cost 12), with timing equalised for unknown emails.
  - 15-minute HS256 access tokens.
  - Opaque refresh tokens stored as SHA-256 hashes in an httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`.
  - Rotation on every refresh with a 10-second grace window for concurrent tabs; reusing an older token revokes the whole session family.
  - Logout, and change password that signs out other sessions.
  - Forced password change for new and reset accounts.
  - Login rate limits per IP+email and per IP.
  - Bootstrap admin from environment variables on an empty database.
- **RBAC:** `authenticate` reloads the user on every request, so deactivation and role changes apply immediately. `authorize(...permissions)` enforces the shared permission map.
- **User management API:** list (search, role, status, sort, pagination), stats, get, create, update (name, email, role, active), reset password. Admins cannot change their own role, deactivate themselves or reset their own password. Deactivating or resetting a user revokes that user's sessions.
- **Web:**
  - React 19, React Router 7 data router, TanStack Query, react-hook-form with shared Zod schemas, Tailwind 4 and shadcn/ui.
  - API client keeps the access token in memory, shares one refresh between concurrent requests and retries once.
  - Login page.
  - Change-password page, used for both forced and voluntary changes.
  - `RequireAuth`, `GuestOnly` and `RequirePermission` guards with redirect back to the requested page.
  - App shell with a permission-filtered sidebar (a sheet on mobile) and a user menu.
  - Role-aware dashboard: the role's capabilities, plus live user counts for admins.
  - Users page with URL-synced filters, pagination, add/edit dialogs with server field errors, temporary password generator, reset password and deactivate/reactivate confirmation.
  - 403 and 404 pages.
- **Dev tooling:** `npm run db:local` runs a persistent single-node replica set without Docker. `npm run seed` creates one demo user per role. The E2E server runs on an in-memory replica set.
- **Infrastructure:** Dockerfiles for the API (Node 22 slim) and the web app (nginx, SPA fallback, `/api` proxy); `docker-compose.yml` with MongoDB 8 as a replica set; GitHub Actions CI running lint, format check, typecheck, tests, build and Playwright.

### Changed files

- Root: `package.json`, `package-lock.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.dockerignore`, `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`, `docs/ARCHITECTURE.md`
- `packages/shared/src/**`
- `apps/api/`: `src/**`, `scripts/{local-db,seed,seed-data,e2e-server}.ts`, `tests/**`, `Dockerfile`, `.env.example`, config files
- `apps/web/`: `src/**` (including shadcn/ui components in `src/components/ui`), `e2e/**`, `Dockerfile`, `nginx.conf`, `index.html`, `public/favicon.svg`, config files

### Test results

- `packages/shared`: 9 unit tests passed (permission map, schema normalisation, password byte limit).
- `apps/api`: 39 integration tests passed (Supertest against an in-memory MongoDB replica set). They cover:
  - Login, generic credential errors, deactivated accounts, validation and rate limiting.
  - Missing, forged and expired tokens.
  - Refresh rotation, concurrent grace and reuse detection.
  - Logout, forced and voluntary password change.
  - RBAC denial for every non-admin role, and role changes applying immediately.
  - User create/list/filter/update/deactivate/reset and self-protection rules.
  - Health, 404, malformed JSON, oversized body, request IDs and security headers.
- `apps/web`: 6 unit tests passed (API client: auth header, refresh-and-retry, session end, shared refresh, error mapping).
- Playwright: 12 E2E tests passed in Chromium. They cover:
  - Redirect to sign-in and back.
  - Wrong-password error and client-side validation.
  - Session restored on reload, and sign-out.
  - Signed-in users redirected away from the login page.
  - Staff with no Users link and a 403 on `/users`.
  - Role-specific dashboard.
  - 404 inside the app.
  - Admin adds a user, who is then forced to change the password.
  - Duplicate email field error.
  - Search plus deactivate, which blocks sign-in.
  - Admin self-protection.
- `npm run lint`, `npm run typecheck`, `prettier --check` and `npm run build` pass. The compiled API was started in production mode against the local replica set and answered `/health`.
- Manual check in the browser against the local stack: sign-in redirect, users list and dashboard with live data, and mobile layout (no page-level horizontal scroll).

### Pending issues

- The Docker images and Compose stack have not been built or run: the Docker engine wasn't running on this machine. `docker compose config` validates.
- CI has not run on GitHub: the repository has no remote yet.
- The web bundle is 720 kB minified (225 kB gzipped). Add route-level code splitting as more pages land.
- `npm audit` reports a moderate `minimatch` advisory in typescript-eslint, a lint-only dev dependency. Runtime dependencies have no findings.

## Phase 2 — Master data and inventory engine (2026-11-08)

### Completed

- **Shared package:**
  - Money helpers: integer minor units, decimal parsing without floating point, basis points.
  - Zod schemas for settings, warehouses, categories, products, suppliers, customers, opening stock, adjustments, thresholds and list queries.
  - DTO types.
- **Settings:** company name and currency (two-decimal currencies only, so minor units stay 1/100). Read by all signed-in users, edited by admins.
- **Warehouses:** CRUD with unique codes and per-warehouse stock totals. A warehouse can be deactivated only once it holds no stock or reservations. Inactive warehouses reject movements.
- **Categories:** unique case-insensitive name and unique code, with product counts. Deletion is blocked while products use the category.
- **Products:**
  - Category required.
  - SKUs generated as `<code>-00001` from an atomic per-category counter, skipping numbers taken by manual SKUs, and unique under concurrent creation.
  - Manual SKUs are normalised to uppercase. SKUs are immutable after creation.
  - Optional unique barcode.
  - Prices in minor units, tax rate in basis points, reorder point and reorder quantity.
  - Each product carries a stock summary: on hand, reserved, available, and how many warehouses hold it or are low.
  - Filters: search (name, SKU, barcode), category, status, stock state (in, low, out), per-warehouse view.
- **Suppliers and customers:** one shared module. Codes are generated (`SUP-0001`, `CUS-0001`) or entered manually, unique and immutable. Suppliers have a lead time; customers have a shipping address. Search, status filter and deactivation.
- **Inventory engine:**
  - `stock.service.applyMovement` is the only code that changes `onHand`. Each call updates the stock level and writes the movement in the same transaction.
  - Withdrawals use a conditional `$expr` filter (`onHand − reserved ≥ qty`), so concurrent requests can't oversell.
  - `inTransaction` retries insert races on first-time upserts. Write conflicts are retried by the driver.
- **Opening stock:**
  - Numbered `OPN-` documents.
  - Allowed only before any movement for that product in that warehouse.
  - Sets the moving weighted average cost.
- **Adjustments:**
  - Numbered `ADJ-` documents with a reason (count, damage, loss, found, correction, other).
  - Signed quantity changes; stock counts submit a counted quantity and the change is computed inside the transaction.
  - Notes required for "other".
  - All-or-nothing: a failing line rolls back the whole document, including its number.
- **Stock levels:** each product per warehouse shows on hand, reserved, available and the threshold in effect. Low stock means available ≤ (warehouse override ?? product threshold) in an active warehouse. Threshold overrides change configuration only and write no movement.
- **Ledger:** movements filterable by product, warehouse, type, direction (stock-in or stock-out) and date range, each linked to its source document.
- **Web:**
  - Products list, add/edit dialog and detail page with stock by warehouse, threshold editing and recent movements.
  - Stock levels, movements and adjustments pages, plus adjustment detail.
  - One form for opening stock and adjustments: product search, live on-hand and resulting balance per line, server errors shown per line.
  - Categories, warehouses, suppliers, customers and settings pages.
  - Low-stock card on the dashboard.
  - URL-synced filters and pagination everywhere; actions shown only to roles that can use them.
- **Seed:** three warehouses, five categories, 19 products, four suppliers and five customers. Opening stock and one adjustment are posted through the services; five product–warehouse combinations are low.

### Fixed during this phase

- **Zod 4 and PATCH:** Zod 4 applies `.default()` values inside `.partial()`, so a PATCH that only changed `name` reset barcode, description, tax rate and thresholds. Update schemas are now built from fields without defaults. There are regression tests in the shared and API suites.
- **Indexes after seeding:** the seed dropped the database and called `Model.init()` to rebuild indexes, but `init()` is memoised and silently skipped, so unique constraints were missing after seeding. It now uses `createIndexes()`, and a seed test checks that duplicates are rejected afterwards.
- **shadcn CLI:** the CLI again added an unrelated `cn` npm package and skipped `command.tsx`. I removed the package, repointed the imports and wrote `command.tsx` on top of `cmdk`.

### Changed files

- `packages/shared/src/`: `money.ts`, `dto.ts`, `schemas/{fields,master-data,stock}.ts`, `api.ts`, `index.ts`, `money.test.ts`
- `apps/api/src/`:
  - `lib/{transaction,counters,pagination}.ts`
  - `modules/{settings,warehouses,categories,products,partners,stock}/**`
  - `app.ts`
- `apps/api/scripts/{seed,seed-data}.ts`
- `apps/api/tests/`: `fixtures.ts`, `master-data.test.ts`, `stock.test.ts`, `seed.test.ts`
- `apps/web/src/`:
  - `lib/{query,use-url-filters}.ts`
  - `components/{table,filters,form-parts,StatusBadge}.tsx`
  - `components/ui/{command,popover,switch,textarea}.tsx`
  - `features/{catalog,stock,partners,settings}/**`
  - dashboard, router and navigation
- `apps/web/e2e/inventory.spec.ts`
- `docs/ARCHITECTURE.md`, `README.md`

### Test results

- `packages/shared`: 18 unit tests passed (money parsing, SKU normalisation, adjustment rules, no defaults in partial updates).
- `apps/api`: 75 integration tests passed. They cover:
  - Settings permissions.
  - Category and warehouse uniqueness, deletion and deactivation rules.
  - Sequential generated SKUs, manual SKU normalisation, duplicate SKUs (case-insensitive), skipping taken numbers, 12 concurrent creations giving unique SKUs, SKU immutability, barcode uniqueness, partial updates preserving fields.
  - Product filters including low and out of stock, and role permissions for every role.
  - Supplier and customer codes, search and permissions.
  - Opening stock: level, movement and document created; quantities separate per warehouse; once per warehouse; weighted average cost; inactive product or warehouse rejected.
  - Adjustments: running balances, stock-in and stock-out history, insufficient stock with full rollback and the document number unused, reserved stock protected, stock counts.
  - Concurrency: 10 parallel withdrawals against 5 units give exactly 5 successes and on-hand 0; 6 parallel stock-ins to a new location create a single stock level.
  - Threshold overrides, level filters, document lists and date filters.
  - Seed integrity.
  - Every stock test ends with a ledger check: on-hand equals the sum of movements, the last balance matches, nothing is negative, and reserved never exceeds on-hand. The stock suite was run three extra times to check for flakiness.
- `apps/web`: 6 unit tests passed.
- Playwright: 19 E2E tests passed (12 existing and 7 new). The new ones cover:
  - Inventory manager adds a product with a generated SKU, registers opening stock, posts a stock-out adjustment, and checks the ledger balances and the stock-out filter.
  - Duplicate SKU field error.
  - Over-withdrawal rejected.
  - Dashboard low-stock card links to the filtered list.
  - Staff have read-only access.
  - Procurement manager adds a supplier with a generated code.
  - New warehouse appears in pickers.
- `npm run lint`, `npm run typecheck`, `prettier --check` and `npm run build` pass.
- Manual check in the browser against the seeded local stack: products list, product detail, dashboard low-stock card, and the adjustment form's on-hand and "after" preview.

### Pending issues

- Stock transfers and the audit log were not part of this phase's request. They are scheduled as roadmap phase 3 (warehouse operations).
- Docker images and CI are still unverified (no running Docker engine, no Git remote).
- The web bundle is now 819 kB minified (250 kB gzipped). Route-level code splitting is still pending.

## Phase 3 — Procurement: purchase requests to goods receipts (2026-11-08)

Delivered under roadmap phase 4 (Procurement). Phase 3 (warehouse operations: transfers and audit log) hasn't been requested yet.

### Completed

- **Permissions:**
  - `purchaseRequests:create`: admin, inventory manager, procurement manager, staff.
  - `purchaseRequests:approve`: admin, procurement manager.
- **Supplier price lists:** supplier × product unit cost and supplier SKU, managed on the supplier page (`suppliers:write`). A product's page shows every supplier's price and marks the lowest.
- **Purchase requests:**
  - Draft, then submitted, then approved, rejected or cancelled.
  - The requester edits, submits and deletes their own drafts.
  - An approver can't approve their own request unless they're an admin.
  - An approved request converts into a draft PO for a chosen supplier, in one transaction, and becomes "ordered". Deleting or cancelling that PO returns the request to approved.
  - Each request keeps a history of actions with who did them and when.
- **Purchase orders:**
  - Draft (editable, deletable), pending approval, approved, then partially received or received; closed or cancelled.
  - Lines priced from the supplier's price list, else the product's cost price; tax per line; expected date from the supplier's lead time.
  - Atomic status transitions with reasons for reject, cancel and close.
  - An approver can't approve their own order unless they're an admin.
  - Cancelling is allowed only before the first receipt; after that, "close remaining" with a reason.
  - Overdue flag; filters for open, overdue, product and supplier; full history.
- **Goods receipts (GRN):**
  - Posted in one transaction: the order lines are checked against what's outstanding and updated, and only accepted units become RECEIPT movements that update the average cost.
  - Rejected and damaged units are recorded on the GRN and the order line but don't count towards what's received.
  - A reason is required for rejected or damaged goods.
  - The receipt date can't be in the future or before the order date.
  - Concurrent receipts against the same order conflict and are retried against fresh quantities.
- **Supplier delivery history:** receipts keep the order's expected date. The summary shows on-time and late deliveries, accepted, rejected and damaged units, and open and overdue orders.
- **Web:**
  - Purchase request list, form and detail, with approve, reject, cancel and convert (supplier choice with a price preview).
  - Purchase order list, form and detail, with an editor showing supplier or product prices and line totals including tax. The detail page shows ordered, received, rejected, damaged and outstanding per line, the receipts and the history.
  - Goods receipt form (accepted, rejected and damaged per line, "accept all outstanding", a preview of units added), list and detail.
  - Supplier detail page with delivery statistics, price list editor, orders and delivery history.
  - Product detail gains "On order" and "Supplier prices" cards and a "Request stock" action.
  - Dashboard tiles for approvals, open orders and overdue deliveries.
  - Ledger rows link to goods receipts.
- **Seed:** supplier price lists; purchase orders that are fully received, partially received with damaged units, overdue, and awaiting approval; one request awaiting approval.

### Fixed or improved during this phase

- Toasts moved from the top-right to the bottom-right. In the top-right they covered the account menu, and hovering a toast pauses its auto-dismiss, so the menu could become unreachable. This surfaced in E2E.
- The purchase order detail page puts its history below the lines on screens narrower than 2xl, so the eight-column lines table doesn't scroll sideways at 1280 px.

### Changed files

- `packages/shared/src/`: `permissions.ts`, `schemas/{procurement,stock,fields}.ts`, `dto-procurement.ts`, `dto.ts`, `index.ts`
- `apps/api/src/`:
  - `modules/purchasing/{models,common,purchase-requests,purchase-orders,goods-receipts,supplier-prices}.ts`
  - `modules/stock/{stock-movement.model,stock.service}.ts`
  - `lib/counters.ts`
  - `app.ts`
- `apps/api/scripts/seed-data.ts`; `apps/api/tests/{procurement.test,fixtures}.ts`
- `apps/web/src/`:
  - `features/purchasing/**`
  - `components/BackLink.tsx`
  - `features/catalog/ProductDetailPage.tsx`
  - `features/dashboard/DashboardPage.tsx`
  - `features/partners/PartnersPage.tsx`
  - `features/stock/MovementsTable.tsx`
  - `app/{router,navigation}.ts(x)`
  - `main.tsx`
- `apps/web/e2e/procurement.spec.ts`
- `docs/ARCHITECTURE.md`, `README.md`

### Test results

- `packages/shared`: 18 unit tests passed.
- `apps/api`: 92 integration tests passed, 17 of them new for procurement. They cover:
  - Supplier pricing with fallback to cost price; totals and tax; expected date from lead time; price permissions.
  - Requests: full flow to a draft PO; converting twice blocked; deleting the PO reopens the request; self-approval blocked; role permissions; reject and cancel; editing only drafts; inactive products rejected.
  - Orders: submit, reject, resubmit and approve with history; self-approval blocked and admin self-approval allowed; cancel before receipts and refused after; receiving refused unless approved.
  - Complete delivery: stock, RECEIPT movement, average cost, order received.
  - Partial deliveries across three receipts, with outstanding quantities kept open and over-receipt rejected.
  - Accepted 12, rejected 3 and damaged 5 of 20: only 12 stocked and 8 still outstanding; the replacement delivery completes the order.
  - A fully rejected delivery changes no stock.
  - Receipt validation: reason, empty, future date, foreign line, permissions.
  - Closing a partially received order.
  - Six concurrent receipts of 2 against 5 outstanding: exactly 2 succeed and 4 are received.
  - Supplier delivery summary with on-time, late, damaged, open and overdue counts; overdue and open filters.
  - Every test ends with the ledger consistency check. The procurement suite was run three extra times to check for flakiness.
- `apps/web`: 6 unit tests passed.
- Playwright: 23 E2E tests passed, 4 of them new. They cover:
  - Staff request → procurement approval and conversion (supplier price shown) → submit (self-approval blocked) → admin approval → staff partial receipt with damaged units (outstanding 4, stock +6) → "accept all outstanding" completes the order (stock +10).
  - Cancelling an approved order with a required reason.
  - Closing a partially received order.
  - The supplier page's delivery history and price list.
- `npm run lint`, `npm run typecheck`, `prettier --check` and `npm run build` pass. All 10 architecture diagrams render.
- Manual check in the browser: purchase order detail at 1280 px with no table overflow, the close dialog, and dashboard purchasing tiles.

### Pending issues

- Stock transfers and the audit log (roadmap phase 3) are still to do.
- Docker images and CI are still unverified (no running Docker engine, no Git remote).
- The web bundle is now 890 kB minified (265 kB gzipped). Route-level code splitting would help.
- Opening a link after signing in as a different user can land on "Access denied", because the app returns to the previous session's page. Harmless, but sending users to the dashboard when the page isn't permitted would be friendlier.
