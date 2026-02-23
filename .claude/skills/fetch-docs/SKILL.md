---
name: fetch-docs
description: "Fetch and index documentation from any website for local retrieval-led reasoning. This skill should be used when the user wants to download docs from a site, create a local docs cache, add a docs index to CLAUDE.md or AGENTS.md, or set up offline access to documentation for a library/framework/tool. Uses firecrawl map for page discovery by default, with llms.txt/sitemap/crawl fallbacks."
---

# Fetch Docs

Fetch documentation from any website into a local directory with a compressed index for CLAUDE.md/AGENTS.md injection. Enables retrieval-led reasoning over external docs.

## When to Use

- User asks to "fetch docs for X", "add X docs", "download documentation for Y"
- User wants to set up a local docs cache for a library, framework, or tool
- User wants to add a docs index to their CLAUDE.md or AGENTS.md
- User references an existing `.llms-txt/`-style setup and wants the same for another site

## Workflow

### 1. Gather Parameters

Determine these from the user's request (ask if unclear):

| Parameter | Required | Description |
|-----------|----------|-------------|
| URL | Yes | Docs site root (e.g., `https://docs.convex.dev`) |
| Name | Yes | Short identifier (e.g., `convex`, `nextjs`) |
| Inject target | No | File to inject index into (CLAUDE.md, AGENTS.md) |
| Instruction | No | Custom instruction for the index block |

### 2. Ensure Firecrawl is Available

Check firecrawl status before running:

```bash
firecrawl --status
```

If not installed: `npm i -g firecrawl-cli && firecrawl login --browser`

### 3. Run the Script

```bash
npx tsx ~/.claude/skills/fetch-docs/scripts/fetch-docs.ts \
  --url <url> \
  --name <name> \
  --inject <target-file> \
  --instruction "<instruction text>"
```

**Discovery order (default):**
1. `firecrawl map` — discovers all URLs on the site (fast, thorough)
2. `llms.txt` fallback — if firecrawl unavailable or finds nothing
3. `sitemap.xml` fallback — parses `<loc>` entries
4. BFS crawl fallback — follows internal links (no deps)

**Options:**
- `--mode firecrawl|llms-txt|sitemap|crawl|auto` — force a discovery mode
- `--search <query>` — filter firecrawl map results (e.g., `"guides"`)
- `--out <dir>` — output directory (default: `.llms-txt/{name}`)
- `--max-pages <n>` — cap total pages (default: 500)
- `--concurrency <n>` — parallel fetches (default: 10)
- `--depth <n>` — max crawl depth for crawl mode (default: 3)

### 4. Verify and Finalize

After the script completes:

1. Check output: `ls .llms-txt/{name}/`
2. Verify index: read `.llms-txt/{name}/_index.txt`
3. If `--inject` was used, confirm the index block exists between `<!-- {NAME}-DOCS-START -->` / `<!-- {NAME}-DOCS-END -->` markers
4. Add to `.gitignore` if docs shouldn't be committed

## Example

```bash
# Fetch Convex docs, inject into CLAUDE.md
npx tsx ~/.claude/skills/fetch-docs/scripts/fetch-docs.ts \
  --url https://docs.convex.dev \
  --name convex \
  --inject CLAUDE.md \
  --instruction "Use retrieval-led reasoning for Convex tasks"
```

## How the Index Block Works

The compressed index minimizes token usage while giving Claude awareness of all available docs:

```
<!-- CONVEX-DOCS-START -->
[convex Docs Index]|root: ./.llms-txt/convex|Use retrieval-led reasoning for Convex tasks
.:{index.md}|database:{reading-data.md,writing-data.md}|auth:{overview.md,setup.md}
<!-- CONVEX-DOCS-END -->
```

Claude reads individual doc files on demand via the Read tool. The index is idempotent — re-running the script updates the block in place.
