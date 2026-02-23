# Plan: Better Convex Integration (Repo-Audited)

## Status
Draft (ready for implementation)

## Goal
Migrate `lattice-mono` from vanilla Convex usage in `@repo/convex` to better-convex (cRPC + ORM + TanStack Query bridge) without breaking Clerk auth, existing webhook behavior, or app boot paths.

## References Used
- `.llms-txt/better-convex/quickstart.md`
- `.llms-txt/better-convex/concepts.md`
- `.llms-txt/better-convex/cli.md`
- `.llms-txt/better-convex/server/setup.md`
- `.llms-txt/better-convex/server/procedures.md`
- `.llms-txt/better-convex/server/context.md`
- `.llms-txt/better-convex/server/metadata.md`
- `.llms-txt/better-convex/migrations/convex.md`
- `.llms-txt/better-convex/react.md`
- `.llms-txt/better-convex/server/http.md`

## Current State Audit (Codebase)

| Path | Current State | Integration Needed |
|---|---|---|
| `convex.json` | Points to `packages/convex/convex/`, no static codegen settings | Move to `packages/convex/convex/functions` and enable `codegen.staticApi/staticDataModel` |
| `packages/convex/package.json` | Uses `convex dev` and `convex codegen` | Switch scripts to `better-convex dev/codegen`; add deps |
| `packages/convex/convex/schema.ts` | Vanilla `defineTable` schema | Migrate to `better-convex/orm` schema + relations |
| `packages/convex/convex/users.ts` | `query/internalMutation` + `v` args | Migrate to cRPC builders + Zod + ORM access |
| `packages/convex/convex/subscriptions.ts` | `query/internalMutation` + `v` args | Migrate to cRPC builders + Zod + ORM access |
| `packages/convex/convex/pages.ts` | Vanilla query/mutation | Migrate to cRPC builders |
| `packages/convex/convex/http.ts` | Vanilla `httpRouter` webhook handlers | Keep paths stable; optionally migrate to cRPC HTTP router later |
| `packages/convex/convex/tsconfig.json` | Convex defaults | Add `strictFunctionTypes: false`; update alias/excludes for new structure |
| `packages/convex/provider.tsx` | `ConvexProviderWithClerk` only | Add QueryClient + CRPC provider layering |
| `packages/convex/client.ts` | Exports `convex/react` hooks + generated API | Add cRPC hooks export surface (`useCRPC`, `useCRPCClient`) |
| `packages/convex/index.ts` | Re-exports generated API from old path | Update generated import path |
| `packages/convex/keys.ts` | Only `NEXT_PUBLIC_CONVEX_URL` | Add `NEXT_PUBLIC_CONVEX_SITE_URL` |
| `apps/app/app/layout.tsx` | Mounts `ConvexClientProvider` | No structural change required |
| `apps/web/app/[locale]/layout.tsx` | No Convex provider mounted | No runtime migration needed now |
| `apps/app/.env.example`, `apps/web/.env.example` | Missing `NEXT_PUBLIC_CONVEX_SITE_URL` | Add for cRPC HTTP transport |
| `.gitignore` | Ignores `packages/convex/convex/_generated` | Update for `packages/convex/convex/functions/_generated` |
| `apps/api/app/webhooks/*` | Separate analytics webhooks | Keep unchanged; do not conflate with Convex webhook handlers |

## Call-site Reality Check

- No active `useQuery`/`useMutation` usage of Convex APIs was found in `apps/app` or `apps/web`.
- Migration scope is therefore backend/package infrastructure first, with only provider-level runtime wiring in `apps/app`.

## Decisions (Locked)

1. Keep Clerk. Do not introduce Better Auth in this migration.
2. Migrate incrementally. Vanilla and cRPC functions can coexist while files are converted.
3. Keep Convex webhook endpoints stable (`/clerk-users-webhook`, `/stripe-webhook`) during migration.
4. Keep `apps/api` webhook routes unchanged (they handle analytics, not Convex DB sync).
5. Prioritize `apps/app` integration. `apps/web` is not currently using Convex runtime provider.
6. Use static codegen and metadata (`meta.ts`) from better-convex CLI.

## Non-Goals (This Plan)

- Better Auth migration
- Full Hono-based cRPC HTTP router rewrite
- RSC prefetch/hydration integration (`better-convex/rsc`)
- Triggers/aggregates/rate-limiting rollout

## Implementation Plan

### Phase 0: Preflight Baseline

- Capture baseline behavior before migration:
  - `pnpm --filter @repo/convex typecheck`
  - `pnpm --filter app typecheck`
  - `pnpm --filter web typecheck`
- Confirm Convex package currently boots in dev:
  - `pnpm --filter @repo/convex dev`

Exit criteria:
- Baseline command outputs captured.

### Phase 1: Structure and Tooling Migration

Files:
- `convex.json`
- `packages/convex/package.json`
- `packages/convex/convex/tsconfig.json`
- `packages/convex/tsconfig.json`
- `.gitignore`
- `packages/convex/keys.ts`
- `apps/app/.env.example`
- `apps/web/.env.example`

Changes:
- Update `convex.json`:
  - `functions: "packages/convex/convex/functions"`
  - `codegen.staticApi: true`
  - `codegen.staticDataModel: true`
- Restructure Convex folder:
  - Move existing function files into `packages/convex/convex/functions/`
  - Add `packages/convex/convex/lib/`
  - Add `packages/convex/convex/shared/`
- Update Convex function tsconfig:
  - Set `strictFunctionTypes: false`
  - Add alias for `@convex/*` -> generated + shared paths
  - Exclude `functions/_generated`
- Update package tsconfig aliases so package-level files can import generated/meta consistently.
- Update `.gitignore` to ignore the new generated path.
- Add `NEXT_PUBLIC_CONVEX_SITE_URL` to keys and env examples.
- Update `packages/convex/package.json`:
  - Add `better-convex`, `@tanstack/react-query`
  - Scripts:
    - `dev: better-convex dev`
    - `codegen: better-convex codegen`
    - `build: test -n "$CONVEX_DEPLOYMENT" && better-convex codegen || echo ...`

Exit criteria:
- `pnpm --filter @repo/convex codegen` generates:
  - `packages/convex/convex/functions/_generated/*`
  - `packages/convex/convex/shared/meta.ts`

### Phase 2: cRPC and ORM Foundation

Files:
- `packages/convex/convex/functions/schema.ts`
- `packages/convex/convex/lib/orm.ts` (new)
- `packages/convex/convex/lib/crpc.ts` (new)

Changes:
- Rewrite schema with `convexTable`, `defineSchema`, `defineRelations`.
- Keep table names aligned with existing data model (`users`, `subscriptions`, `pages`) to avoid data migration.
- Create `withOrm(ctx)` helper and attach to query/mutation context in cRPC init.
- Create cRPC builders:
  - `publicQuery`, `publicMutation`, `publicAction`
  - `privateQuery`, `privateMutation`, `privateAction`
  - `optionalAuthQuery`, `authQuery`, `authMutation`
  - `publicRoute`, `router`
- Implement Clerk-compatible auth middleware using `ctx.auth.getUserIdentity()` + user lookup by `externalId`.
- Add typed metadata shape for auth semantics (`optional`/`required`) so client-side auth-aware behavior can be adopted later.

Exit criteria:
- Convex functions compile with cRPC foundation.
- No schema name drift vs existing tables.

### Phase 3: Procedure Migration (Module by Module)

Files:
- `packages/convex/convex/functions/users.ts`
- `packages/convex/convex/functions/subscriptions.ts`
- `packages/convex/convex/functions/pages.ts`

Changes:
- Convert each exported procedure from vanilla config to fluent cRPC syntax.
- Replace `v.*` validators with Zod `.input(z.object(...))`.
- Prefer `.output(...)` for client-facing procedures due static API mode.
- Map intended access levels:
  - `users.upsertFromClerk`: `privateMutation`
  - `users.deleteFromClerk`: `privateMutation`
  - `users.current`: `optionalAuthQuery`
  - `subscriptions.upsertSubscription`: `privateMutation`
  - `subscriptions.cancelSubscription`: `privateMutation`
  - `subscriptions.getByUserId`: migrate to auth-safe query variant or enforce caller ownership
  - `pages.list/create`: public or auth-gated based on product needs
- Preserve export names where practical to minimize downstream churn.

Important migration note:
- Fix existing weak subscription-linking behavior (currently first-user fallback) as part of this phase or explicitly gate rollout until deterministic user mapping exists.

Exit criteria:
- All target modules use cRPC builders.
- No remaining `v.*` usage in migrated files.

### Phase 4: Webhook Path Safety and HTTP Strategy

Files:
- `packages/convex/convex/functions/http.ts`
- `apps/api/app/webhooks/auth/route.ts` (read-only confirmation)
- `apps/api/app/webhooks/payments/route.ts` (read-only confirmation)

Changes:
- Keep current Convex webhook endpoint paths unchanged.
- Keep Convex `httpRouter` for this migration unless a typed HTTP client requirement appears.
- Update only internals needed due function path/name moves.
- Document dual-webhook architecture clearly:
  - Convex endpoints: DB sync mutations
  - `apps/api` endpoints: analytics and provider-specific side effects

Optional follow-up:
- Migrate to `better-convex` HTTP router (`publicRoute` + Hono) after cRPC core is stable.

Exit criteria:
- Webhook routes still resolve and call expected internal procedures.

### Phase 5: Client Integration in `@repo/convex`

Files:
- `packages/convex/crpc.tsx` (new)
- `packages/convex/provider.tsx`
- `packages/convex/client.ts`
- `packages/convex/index.ts`

Changes:
- Create cRPC context using generated `api` and `meta` with `NEXT_PUBLIC_CONVEX_SITE_URL`.
- Update provider composition:
  - Keep `ConvexProviderWithClerk` outer wrapper
  - Add QueryClient singleton + ConvexQueryClient singleton
  - Add `CRPCProvider`
- Export cRPC hooks from package client surface.
- Update generated import paths for moved `_generated` directory.

App integration impact:
- `apps/app/app/layout.tsx` should continue to work unchanged (same provider import path).
- `apps/web` remains unchanged unless Convex runtime usage is added there.

Exit criteria:
- `apps/app` boots with provider stack and no runtime provider errors.

### Phase 6: Verification and Rollout Gates

Required verification commands:
- `pnpm --filter @repo/convex codegen`
- `pnpm --filter @repo/convex typecheck`
- `pnpm --filter app typecheck`
- `pnpm --filter web typecheck`
- `pnpm build`

Runtime checks:
- Start dev stack (`pnpm dev`) and confirm app render with `ConvexClientProvider` active.
- Execute at least one cRPC query from `apps/app` and confirm data + type inference.
- Confirm webhook endpoints are reachable in Convex runtime:
  - missing/invalid signature should return controlled 4xx (not 404)
- Run provider-level smoke for Clerk-authenticated query path.

Deployment checks:
- Confirm `NEXT_PUBLIC_CONVEX_SITE_URL` is set in deployed env for any app using cRPC.
- Confirm webhook providers still target intended endpoints (Convex and/or `apps/api`, depending on event purpose).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Missing `NEXT_PUBLIC_CONVEX_SITE_URL` | cRPC HTTP path fails at runtime | Add key + env example updates + deployment checklist |
| Generated path changes break imports | Type/runtime failures | Centralize generated imports and verify with codegen + typecheck |
| Clerk auth integration mismatches cRPC auth metadata behavior | Unauthorized loops or skipped behavior mismatch | Keep `ConvexProviderWithClerk`; test authenticated and unauthenticated flows explicitly |
| Webhook path regressions | User/subscription sync stops | Keep path constants stable; run post-migration webhook smoke checks |
| Subscription linking logic is currently non-deterministic | Wrong user-subscription linkage | Fix mapping before rollout or gate release |

## Stop Rule (Avoid Feature Creep)

This plan is complete when all conditions are true:
1. cRPC + ORM are live in `@repo/convex` for the audited modules.
2. `apps/app` runs with the new provider stack.
3. Typecheck/build/codegen all pass.
4. Convex webhook endpoints still work on the same URLs.

Anything beyond that (Better Auth, RSC, Hono HTTP rewrite, aggregates/triggers) is a follow-up plan.
