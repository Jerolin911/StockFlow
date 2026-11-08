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
