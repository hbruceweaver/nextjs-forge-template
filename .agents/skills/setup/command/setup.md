---
description: Audit and configure third-party services for the next-forge template. Shows which services are configured vs missing and walks you through setting up each one.
---

Guided setup wizard for next-forge template services.

## Workflow

### Step 1: Load the setup skill

Read the SKILL.md file at `.agents/skills/setup/SKILL.md` to get the full service catalog, env var mappings, and tier definitions.

### Step 1.5: Choose database stack

Use `AskUserQuestion` to ask the user which database stack to use:

- **Convex** — Real-time backend with TypeScript queries, mutations, and serverless functions. Best for real-time apps.
- **Prisma + Neon** — Traditional SQL with Prisma ORM and serverless Postgres. Best for relational data.

If the user chooses **Convex**:
1. Ask for `NEXT_PUBLIC_CONVEX_URL` — write to `apps/app/.env.local` and `apps/web/.env.local`
2. Ask for `CONVEX_DEPLOY_KEY` — write to `apps/app/.env.local`
3. Instruct user to set `CLERK_WEBHOOK_SECRET` in Convex Dashboard > Environment Variables
4. Instruct user to configure Clerk webhook endpoint to `https://<deployment>.convex.site/clerk-users-webhook`
5. Instruct user to set `STRIPE_WEBHOOK_SECRET` in Convex Dashboard and point Stripe webhook to `https://<deployment>.convex.site/stripe-webhook`
6. Skip the `DATABASE_URL` / Neon setup entirely

If the user chooses **Prisma + Neon**, proceed with the existing `DATABASE_URL` flow.

### Step 2: Audit current env state

Read all `.env.local` files listed in SKILL.md Step 1. For each service in the catalog, check whether its key env vars have non-empty values (a value of `""` means unconfigured).

### Step 3: Present status dashboard

Show a markdown table of all services grouped by tier, with their configuration status:

- **Configured**: All required vars have non-empty values
- **Partial**: Some vars configured, some missing
- **Not configured**: All vars empty or missing

### Step 4: Ask what to configure

Use `AskUserQuestion` to ask the user which services they want to set up. Offer tier-based options:

- "Set up all Core services" (Tier 1)
- "Set up Recommended services" (Tier 2)
- "Choose specific services"

### Step 5: Walk through each selected service

For each service:

1. Explain what the service does (one sentence)
2. Show the signup URL
3. Explain where to find the key(s) in the service's dashboard
4. Use `AskUserQuestion` to collect each key from the user
5. Write the key to ALL required `.env.local` files (see "Files" column in SKILL.md)
6. Confirm written with the file paths

### Step 6: Verify build

After all selected services are configured, run:

```bash
pnpm turbo build
```

Report whether the build passes. If it fails, diagnose and help fix.

### Step 7: Summary

Show final status dashboard with updated configuration state.

<user-request>
$ARGUMENTS
</user-request>
