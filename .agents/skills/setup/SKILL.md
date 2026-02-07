---
name: setup
description: |
  Guided setup for next-forge template services. Audits configured vs missing
  env vars, shows a status dashboard, and walks users through configuring each
  service interactively. Use when user runs /setup or asks about configuring
  services, API keys, or environment variables.
metadata:
  version: 1.0.0
---

# Setup Skill

Audit and configure third-party services for the next-forge monorepo template.

## Overview

This template integrates ~17 services via environment variables spread across multiple apps and packages. Each service's keys are validated in `packages/<name>/keys.ts` using `@t3-oss/env-nextjs` + Zod. All service keys are **optional** — the template builds with zero keys configured.

## Audit Workflow

### Step 1: Read all `.env.local` files

Read these files to determine current configuration state:

| File | Purpose |
|------|---------|
| `apps/app/.env.local` | Main app (dashboard) |
| `apps/web/.env.local` | Marketing site |
| `apps/api/.env.local` | API server |
| `packages/database/.env.example` | Database (check for `.env.local` too) |
| `packages/cms/.env.local` | CMS (BaseHub) |
| `packages/internationalization/.env.local` | i18n (Languine) |

### Step 1.5: Ask database stack choice

Before auditing, ask the user which database stack they want to use:

- **Option A: Convex** — Real-time backend with TypeScript queries, mutations, and serverless functions. Uses `@repo/convex`.
- **Option B: Prisma + Neon** — Traditional SQL with Prisma ORM and serverless Postgres. Uses `@repo/database`.

This choice determines which database service appears in the status dashboard and which env vars to configure. Both packages exist in the repo; the user simply configures the one they chose.

### Step 2: Check each service's required vars

For each service, check if the key env vars have non-empty values. A var with `=""` is **unconfigured**.

### Step 3: Present status dashboard

Display a table like:

```
Service          Status       Tier
─────────────────────────────────────
Clerk            Configured   Core
Neon (Postgres)  Missing      Core
App URLs         Configured   Core
Stripe           Missing      Recommended
Resend           Missing      Recommended
PostHog          Missing      Recommended
BaseHub          Missing      Recommended
...
```

Use AskUserQuestion to ask which tier or specific services to configure.

### Step 4: Walk through selected services

For each service the user selects:
1. Show what the service does and link to signup
2. Ask user to paste their key(s)
3. Write the key(s) to the correct `.env.local` file(s)
4. Confirm written

### Step 5: Verify build

After configuration, run `pnpm turbo build` to confirm everything works.

---

## Service Catalog

### Tier 1 — Core

These services are needed for most functionality.

#### Clerk (Authentication)

- **What**: User authentication, sign-in/sign-up flows
- **Signup**: https://dashboard.clerk.com/sign-up
- **Used by**: `app`, `web`, `api`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `CLERK_SECRET_KEY` | `sk_...` | `apps/app`, `apps/web`, `apps/api` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_...` | `apps/app`, `apps/web`, `apps/api` |
| `CLERK_WEBHOOK_SECRET` | `whsec_...` | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: Clerk Dashboard > your app > API Keys
- **Pre-configured** (don't need user input):
  - `NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"`
  - `NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"`
  - `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/"`
  - `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/"`

#### Neon / Postgres (Database — Option B)

- **What**: Serverless Postgres database
- **Signup**: https://console.neon.tech/signup
- **Used by**: `app`, `api`, `packages/database`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `DATABASE_URL` | `postgresql://...` | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: Neon Console > your project > Connection Details > Connection string
- **Note**: Skip this if you chose Convex as your database stack.

#### Convex (Backend — Option A)

- **What**: Real-time backend with TypeScript queries, mutations, and serverless functions
- **Signup**: https://dashboard.convex.dev
- **Used by**: `app`, `web`, `packages/convex`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `NEXT_PUBLIC_CONVEX_URL` | `https://....convex.cloud` | `apps/app`, `apps/web` |
| `CONVEX_DEPLOY_KEY` | `prod:...` or `dev:...` | `apps/app` |
| `CLERK_WEBHOOK_SECRET` | `whsec_...` | Convex env vars (dashboard) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Convex env vars (dashboard) |

- **How to get**: Run `npx convex dev` in the repo, or Convex Dashboard > Settings > URL & Deploy Key
- **Note**: Webhook secrets go in Convex Dashboard environment variables, not `.env.local`. Configure Clerk webhook endpoint to `https://<deployment>.convex.site/clerk-users-webhook` and Stripe webhook to `https://<deployment>.convex.site/stripe-webhook`.
- **Note**: Skip this if you chose Prisma + Neon as your database stack.

#### App URLs

- **What**: Cross-app URL references for the monorepo
- **Used by**: All apps
- **Env vars** (pre-configured with localhost defaults):

| Variable | Default | Files |
|----------|---------|-------|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `apps/app`, `apps/web`, `apps/api` |
| `NEXT_PUBLIC_WEB_URL` | `http://localhost:3001` | `apps/app`, `apps/web`, `apps/api` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3002` | `apps/web` |
| `NEXT_PUBLIC_DOCS_URL` | `http://localhost:3004` | `apps/app`, `apps/web`, `apps/api` |

- **Note**: These only need updating for production deployments.

---

### Tier 2 — Recommended

Common features most projects will want.

#### Stripe (Payments)

- **What**: Payment processing, subscriptions, billing
- **Signup**: https://dashboard.stripe.com/register
- **Used by**: `api`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `STRIPE_SECRET_KEY` | `sk_...` | `apps/app`, `apps/web`, `apps/api` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: Stripe Dashboard > Developers > API Keys (use test mode keys for dev)

#### Resend (Email)

- **What**: Transactional email sending
- **Signup**: https://resend.com/signup
- **Used by**: `app`, `web`, `api`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `RESEND_TOKEN` | `re_...` | `apps/app`, `apps/web`, `apps/api` |
| `RESEND_FROM` | email address | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: Resend Dashboard > API Keys > Create API Key
- **Note**: `RESEND_FROM` is your verified sender email (e.g. `hello@yourdomain.com`)

#### PostHog (Analytics)

- **What**: Product analytics, event tracking, session replay
- **Signup**: https://app.posthog.com/signup
- **Used by**: `app`, `web`, `api`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `NEXT_PUBLIC_POSTHOG_KEY` | `phc_...` | `apps/app`, `apps/web`, `apps/api` |
| `NEXT_PUBLIC_POSTHOG_HOST` | URL | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: PostHog > Project Settings > Project API Key
- **Note**: Host is typically `https://us.i.posthog.com` or `https://eu.i.posthog.com`

#### BaseHub (CMS)

- **What**: Headless CMS for marketing site content
- **Signup**: https://basehub.com
- **Used by**: `web`, `packages/cms`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `BASEHUB_TOKEN` | `bshb_pk_...` | `apps/app`, `apps/web`, `apps/api`, `packages/cms` |

- **How to get**: BaseHub Dashboard > your project > Settings > API Tokens

---

### Tier 3 — Optional

Specialized features you can add as needed.

#### Liveblocks (Collaboration)

- **What**: Real-time collaboration features (cursors, presence)
- **Signup**: https://liveblocks.io
- **Used by**: `app`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `LIVEBLOCKS_SECRET` | `sk_...` | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: Liveblocks Dashboard > your project > API Keys > Secret key

#### Arcjet (Security)

- **What**: Bot protection, rate limiting, email validation
- **Signup**: https://arcjet.com
- **Used by**: `app`, `web`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `ARCJET_KEY` | `ajkey_...` | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: Arcjet Dashboard > your site > Settings > API Key

#### Svix (Webhooks)

- **What**: Webhook delivery and management
- **Signup**: https://www.svix.com
- **Used by**: `app`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `SVIX_TOKEN` | `sk_...` or `testsk_...` | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: Svix Dashboard > API Keys

#### Knock (Notifications)

- **What**: In-app notifications, feeds, preferences
- **Signup**: https://knock.app
- **Used by**: `app`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `KNOCK_SECRET_API_KEY` | string | `apps/app` |
| `NEXT_PUBLIC_KNOCK_API_KEY` | string | `apps/app` |
| `NEXT_PUBLIC_KNOCK_FEED_CHANNEL_ID` | string | `apps/app` |

- **How to get**: Knock Dashboard > Developers > API Keys

#### Upstash (Rate Limiting)

- **What**: Serverless Redis for rate limiting
- **Signup**: https://console.upstash.com
- **Used by**: `web`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `UPSTASH_REDIS_REST_URL` | URL | (not in app `.env.local` by default — add to `apps/web`) |
| `UPSTASH_REDIS_REST_TOKEN` | string | (not in app `.env.local` by default — add to `apps/web`) |

- **How to get**: Upstash Console > your database > REST API section

#### OpenAI (AI)

- **What**: AI/LLM features (chat, completion, embeddings)
- **Signup**: https://platform.openai.com/signup
- **Used by**: `app` (via `@repo/ai` — not wired by default)
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `OPENAI_API_KEY` | `sk-...` | (add to the app that imports `@repo/ai`) |

- **How to get**: OpenAI Platform > API Keys > Create new secret key

#### BetterStack (Logging)

- **What**: Log management and uptime monitoring
- **Signup**: https://betterstack.com
- **Used by**: `app`, `web`, `api`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `BETTERSTACK_API_KEY` | string | `apps/app`, `apps/web`, `apps/api` |
| `BETTERSTACK_URL` | URL | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: BetterStack > your source > Connect source > API token & ingestion URL

#### Sentry (Error Tracking)

- **What**: Error tracking and performance monitoring
- **Signup**: https://sentry.io/signup (or via Vercel Marketplace)
- **Used by**: `app`, `web`, `api`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `SENTRY_ORG` | string | `apps/app`, `apps/web`, `apps/api` |
| `SENTRY_PROJECT` | string | `apps/app`, `apps/web`, `apps/api` |
| `NEXT_PUBLIC_SENTRY_DSN` | URL | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: Sentry > Settings > Organization Slug + Project Slug; DSN from Project Settings > Client Keys
- **Note**: Easiest via Vercel Marketplace integration which auto-configures these

#### Vercel Blob (Storage)

- **What**: File/blob storage
- **Signup**: Via Vercel Dashboard > Storage
- **Used by**: (not wired by default — `@repo/storage`)
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `BLOB_READ_WRITE_TOKEN` | string | (add to the app that imports `@repo/storage`) |

- **How to get**: Vercel Dashboard > Storage > your blob store > Settings > Tokens

#### Languine (Internationalization)

- **What**: Automated translation management
- **Signup**: https://languine.ai
- **Used by**: `packages/internationalization`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `LANGUINE_PROJECT_ID` | string | `packages/internationalization` |

- **How to get**: Languine Dashboard > your project > Settings

#### Feature Flags

- **What**: Feature flag management (Vercel Toolbar integration)
- **Used by**: `app`, `web`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `FLAGS_SECRET` | string | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: Generate with `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`

#### Google Analytics

- **What**: Web analytics (alongside or instead of PostHog)
- **Signup**: https://analytics.google.com
- **Used by**: `app`, `web`, `api`
- **Env vars**:

| Variable | Format | Files |
|----------|--------|-------|
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `G-...` | `apps/app`, `apps/web`, `apps/api` |

- **How to get**: GA4 > Admin > Data Streams > your stream > Measurement ID

---

## Writing Env Vars

When writing a key to `.env.local` files:

1. Read the current `.env.local` file
2. Find the line with the variable name (e.g. `STRIPE_SECRET_KEY=""`)
3. Replace the empty value with the user's value: `STRIPE_SECRET_KEY="sk_test_abc123"`
4. Write the file back
5. If the variable doesn't exist in the file yet, add it under the appropriate `# Server` or `# Client` comment

**Important**: Some vars need to go in multiple `.env.local` files. The "Files" column in each service table shows which files need the var. Always update ALL listed files.

## Package ↔ App Mapping

Which `keys.ts` packages are imported by which apps (via `env.ts`):

| Package | `app` | `web` | `api` |
|---------|-------|-------|-------|
| `@repo/auth` | yes | — | yes |
| `@repo/analytics` | yes | — | yes |
| `@repo/collaboration` | yes | — | — |
| `@repo/convex` | yes | yes | — |
| `@repo/database` | yes | — | yes |
| `@repo/email` | yes | yes | yes |
| `@repo/feature-flags` | yes | yes | — |
| `@repo/next-config` | yes | yes | yes |
| `@repo/notifications` | yes | — | — |
| `@repo/observability` | yes | yes | yes |
| `@repo/security` | yes | yes | — |
| `@repo/webhooks` | yes | — | — |
| `@repo/payments` | — | — | yes |
| `@repo/cms` | — | yes | — |
| `@repo/rate-limit` | — | yes | — |
| `@repo/ai` | — | — | — |
| `@repo/storage` | — | — | — |
