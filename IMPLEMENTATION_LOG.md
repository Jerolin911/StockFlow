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
