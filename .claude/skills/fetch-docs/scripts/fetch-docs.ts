#!/usr/bin/env npx tsx
/**
 * Fetches documentation from any site and saves locally with a compressed index.
 *
 * Discovery (default: firecrawl):
 *   1. firecrawl scrape --format links on the root page (gets nav/sidebar links)
 *   2. firecrawl map to supplement with any pages not linked from root
 *   3. Deduplicates and filters to same-domain doc URLs
 *
 * Fallbacks: llms.txt → sitemap.xml → BFS crawl
 *
 * Usage:
 *   npx tsx fetch-docs.ts --url https://docs.example.com --name example
 *   npx tsx fetch-docs.ts --url https://docs.example.com/llms.txt --name example --mode llms-txt
  npx tsx fetch-docs.ts --url https://github.com/vercel/next.js --name nextjs --repo-path docs/ --mode github
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { parseArgs } from "node:util";
import { execSync } from "node:child_process";

// ── CLI args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    name: { type: "string" },
    out: { type: "string" },
    inject: { type: "string", multiple: true },
    instruction: { type: "string" },
    "base-url": { type: "string" },
    mode: { type: "string" }, // github | firecrawl | llms-txt | sitemap | crawl | auto
    concurrency: { type: "string", default: "10" },
    "max-pages": { type: "string", default: "500" },
    depth: { type: "string", default: "3" },
    search: { type: "string" },
    repo: { type: "string" },
    "repo-path": { type: "string" },
    branch: { type: "string" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (args.help || !args.url || !args.name) {
  console.log(`
fetch-docs — Fetch documentation from any site into a local directory with compressed index.

Usage:
  npx tsx fetch-docs.ts --url <url-or-path> --name <name> [options]

Required:
  --url         URL to docs site root, llms.txt, sitemap.xml, or local file path
  --name        Name for the docs collection (used for output dir and markers)

Options:
  --out         Output directory (default: .llms-txt/{name})
  --inject      Files to inject index into (repeatable; auto-detects AGENTS.md + CLAUDE.md if omitted)
  --instruction Instruction text to include in the index block
  --base-url    Base URL for resolving relative paths (auto-detected from --url)
  --mode        Discovery: github | firecrawl (default) | llms-txt | sitemap | crawl | auto
  --repo        GitHub repo (owner/repo) — pulls raw source files instead of scraping
  --repo-path   Path within repo to docs (e.g., "docs/") — required with --repo
  --branch      Git branch (default: auto-detect default branch)
  --search      Filter term for firecrawl map (e.g., "docs" or "api")
  --concurrency Fetch concurrency (default: 10)
  --max-pages   Maximum pages to fetch (default: 500)
  --depth       Max crawl depth for crawl mode (default: 3)
  --help        Show this help message

Examples:
  npx tsx fetch-docs.ts --url https://docs.convex.dev --name convex --inject CLAUDE.md --inject AGENTS.md
  npx tsx fetch-docs.ts --url https://docs.example.com --name example --search "guides"
  npx tsx fetch-docs.ts --url https://docs.example.com/llms.txt --name example --mode llms-txt
  npx tsx fetch-docs.ts --url https://github.com/vercel/next.js --name nextjs --repo-path docs/ --mode github
`);
  process.exit(0);
}

const CONCURRENCY = parseInt(args.concurrency ?? "10", 10);
const MAX_PAGES = parseInt(args["max-pages"] ?? "500", 10);
const MAX_DEPTH = parseInt(args.depth ?? "3", 10);
const NAME = args.name!;
const OUT_DIR = args.out ?? `.llms-txt/${NAME}`;
const INJECT_FILES: string[] = (() => {
  const explicit = args.inject ?? [];
  if (explicit.length > 0) return explicit;
  // Auto-detect AGENTS.md and CLAUDE.md in cwd
  const candidates = ['AGENTS.md', 'CLAUDE.md'];
  return candidates.filter((f) => existsSync(f));
})();
const INSTRUCTION = args.instruction ?? `IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any ${NAME} tasks.`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocEntry {
  title: string;
  url: string;
  path: string;
}

type DiscoveryMode = "github" | "firecrawl" | "llms-txt" | "sitemap" | "crawl";

// ── Utilities ─────────────────────────────────────────────────────────────────

async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function normalizeBaseUrl(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/[^/]*\.[^/]+$/, "/");
  return `${u.protocol}//${u.host}${path}`.replace(/\/+$/, "/");
}

function urlToRelPath(url: string, baseUrl: string): string {
  let rel = url;
  if (rel.startsWith(baseUrl)) {
    rel = rel.slice(baseUrl.length);
  } else {
    try {
      const base = new URL(baseUrl);
      const full = new URL(url);
      if (full.host === base.host) {
        // Strip the base path prefix too
        const basePath = base.pathname.replace(/\/+$/, "");
        if (full.pathname.startsWith(basePath)) {
          rel = full.pathname.slice(basePath.length + 1);
        } else {
          rel = full.pathname.slice(1);
        }
      }
    } catch { /* keep as-is */ }
  }
  rel = rel.replace(/^\/+/, "").replace(/[?#].*$/, "");
  if (!rel || rel.endsWith("/")) rel += "index.md";
  if (!extname(rel)) rel += ".md";
  if (extname(rel) !== ".md") rel = rel.replace(/\.[^.]+$/, ".md");
  return rel;
}

function isDocUrl(url: string, baseUrl: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(baseUrl);
    if (u.host !== base.host) return false;
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // Must be under the base path
    const basePath = base.pathname.replace(/\/+$/, "");
    if (basePath && !u.pathname.startsWith(basePath)) return false;
    // Skip fragment-only links
    if (u.hash && u.pathname === base.pathname) return false;
    const skip = ["/_next/", "/static/", "/assets/", "/images/", "/img/"];
    if (skip.some((s) => u.pathname.includes(s))) return false;
    // Skip locale-prefixed paths (e.g., /zh-CN/, /ja-JP/, /en/)
    const relPath = basePath ? u.pathname.slice(basePath.length) : u.pathname;
    if (/^\/[a-z]{2}(-[A-Z]{2})?(\/|$)/.test(relPath)) return false;
    const ext = extname(u.pathname);
    if (ext && ![".md", ".html", ".htm", ".txt", ""].includes(ext)) return false;
    return true;
  } catch {
    return false;
  }
}

function dedupeEntries(entries: DocEntry[]): DocEntry[] {
  const seenUrl = new Set<string>();
  const seenPath = new Set<string>();
  return entries.filter((e) => {
    const urlKey = e.url.replace(/\/+$/, "").replace(/#.*$/, "");
    if (seenUrl.has(urlKey) || seenPath.has(e.path)) return false;
    seenUrl.add(urlKey);
    seenPath.add(e.path);
    return true;
  });
}


// ── Discovery: GitHub repo (raw source files) ─────────────────────────────────

function parseGithubUrl(url: string): { owner: string; repo: string; path?: string } | null {
  try {
    const u = new URL(url);
    if (u.host !== "github.com") return null;
    const parts = u.pathname.replace(/^\//, "").replace(/\/$/, "").split("/");
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    // Handle /tree/branch/path patterns
    let path: string | undefined;
    if (parts[2] === "tree" && parts.length > 3) {
      // parts[3] is branch, rest is path
      path = parts.slice(4).join("/");
    }
    return { owner, repo, path };
  } catch {
    return null;
  }
}

function ghAvailable(): boolean {
  try {
    execSync("which gh", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function tryGithub(
  repoSlug: string,
  repoPath: string,
  branch?: string,
  maxPages?: number,
): Promise<{ entries: DocEntry[]; mode: DiscoveryMode } | null> {
  if (!ghAvailable()) {
    console.log("  gh CLI not found — install from https://cli.github.com");
    return null;
  }

  const [owner, repo] = repoSlug.split("/");
  if (!owner || !repo) {
    console.log("  Invalid repo format, expected owner/repo");
    return null;
  }

  // Auto-detect default branch if not specified
  if (!branch) {
    try {
      const repoInfo = execSync(
        `gh api repos/${owner}/${repo} --jq .default_branch`,
        { encoding: "utf-8", timeout: 10_000 },
      ).trim();
      branch = repoInfo || "main";
      console.log(`  Default branch: ${branch}`);
    } catch {
      branch = "main";
    }
  }

  // Normalize repo path
  const cleanPath = repoPath.replace(/^\/+/, "").replace(/\/+$/, "");
  console.log(`  Fetching tree for ${owner}/${repo}@${branch}:${cleanPath}/...`);

  try {
    const treeJson = execSync(
      `gh api repos/${owner}/${repo}/git/trees/${branch}?recursive=1 --paginate`,
      { encoding: "utf-8", timeout: 30_000, maxBuffer: 50 * 1024 * 1024 },
    );
    const tree = JSON.parse(treeJson);
    const files: Array<{ path: string; type: string }> = tree.tree ?? [];

    const docExts = [".md", ".mdx", ".txt"];
    const docFiles = files.filter((f) => {
      if (f.type !== "blob") return false;
      if (!f.path.startsWith(cleanPath + "/")) return false;
      const ext = f.path.slice(f.path.lastIndexOf("."));
      return docExts.includes(ext);
    });

    if (docFiles.length === 0) {
      console.log(`  No doc files found under ${cleanPath}/`);
      return null;
    }

    const cap = maxPages ?? MAX_PAGES;
    const capped = docFiles.slice(0, cap);
    console.log(`  Found ${docFiles.length} doc files${docFiles.length > cap ? ` (capped to ${cap})` : ""}`);

    const entries: DocEntry[] = capped.map((f) => {
      // Strip the repo-path prefix for the local path
      const relPath = f.path.slice(cleanPath.length + 1);
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${f.path}`;
      const title = relPath.replace(/\.(md|mdx|txt)$/, "").split("/").pop() ?? relPath;
      return { title, url: rawUrl, path: relPath };
    });

    return { entries: dedupeEntries(entries), mode: "github" };
  } catch (e: any) {
    console.log(`  GitHub tree fetch failed: ${e.message?.split("\n")[0]}`);
    return null;
  }
}

// ── Discovery: firecrawl (scrape links + map) ─────────────────────────────────

function firecrawlAvailable(): boolean {
  try {
    execSync("which firecrawl", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function tryFirecrawl(
  baseUrl: string,
  rootUrl: string,
  maxPages: number,
  search?: string,
): Promise<{ entries: DocEntry[]; mode: DiscoveryMode } | null> {
  if (!firecrawlAvailable()) {
    console.log("  firecrawl CLI not found — install with: npm i -g firecrawl-cli");
    return null;
  }

  const allUrls = new Set<string>();
  const cleanUrl = rootUrl.replace(/\/+$/, "");

  // Step 1: scrape links from the root page (gets sidebar/nav — most reliable)
  console.log(`  Scraping links from ${cleanUrl}...`);
  try {
    const tmpFile = `/tmp/fetch-docs-links-${NAME}.json`;
    execSync(
      `firecrawl scrape ${cleanUrl} --format links -o ${tmpFile}`,
      { encoding: "utf-8", timeout: 30_000, stdio: ["ignore", "ignore", "ignore"] },
    );
    const data = JSON.parse(readFileSync(tmpFile, "utf-8"));
    const links: string[] = data.links ?? [];
    let docLinks = 0;
    for (const link of links) {
      const cleaned = link.replace(/#.*$/, "").replace(/\/+$/, "");
      if (isDocUrl(cleaned, baseUrl)) {
        allUrls.add(cleaned);
        docLinks++;
      }
    }
    console.log(`  Scraped ${links.length} links, ${docLinks} doc pages`);
  } catch (e: any) {
    console.log(`  scrape links failed: ${e.message?.split("\n")[0]}`);
  }

  // Step 2: firecrawl map to supplement (catches pages not linked from root)
  console.log(`  Running firecrawl map...`);
  try {
    let cmd = `firecrawl map ${cleanUrl} --limit ${maxPages}`;
    if (search) cmd += ` --search "${search}"`;
    const output = execSync(cmd, { encoding: "utf-8", timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
    const urls = output.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("http"));
    let added = 0;
    for (const url of urls) {
      const cleaned = url.replace(/#.*$/, "").replace(/\/+$/, "");
      if (isDocUrl(cleaned, baseUrl) && !allUrls.has(cleaned)) {
        allUrls.add(cleaned);
        added++;
      }
    }
    console.log(`  map found ${urls.length} URLs, ${added} new doc pages`);
  } catch (e: any) {
    console.log(`  firecrawl map failed: ${e.message?.split("\n")[0]}`);
  }

  if (allUrls.size === 0) return null;

  const entries: DocEntry[] = [];
  for (const url of allUrls) {
    const path = urlToRelPath(url, baseUrl);
    const title = path.replace(/\.md$/, "").split("/").pop() ?? path;
    entries.push({ title, url, path });
  }

  console.log(`  Total: ${entries.length} unique doc pages`);
  return { entries: dedupeEntries(entries), mode: "firecrawl" };
}

// ── Discovery: llms.txt ───────────────────────────────────────────────────────

function parseLlmsTxt(content: string, baseUrl: string): DocEntry[] {
  const entries: DocEntry[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^-\s+\[(.+?)\]\((.+?)\)/);
    if (match) {
      const [, title, url] = match;
      let fullUrl = url;
      try { fullUrl = new URL(url, baseUrl).href; } catch { /* keep as-is */ }
      const path = urlToRelPath(fullUrl, baseUrl);
      entries.push({ title, url: fullUrl, path });
    }
  }
  return entries;
}

async function tryLlmsTxt(
  baseUrl: string,
): Promise<{ entries: DocEntry[]; mode: DiscoveryMode } | null> {
  const llmsUrl = baseUrl.replace(/\/+$/, "") + "/llms.txt";
  console.log(`  Trying ${llmsUrl}...`);
  try {
    const res = await fetch(llmsUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "text/plain, text/markdown, */*" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const entries = parseLlmsTxt(text, baseUrl);
    if (entries.length === 0) return null;
    console.log(`  Found ${entries.length} entries in llms.txt`);
    return { entries, mode: "llms-txt" };
  } catch {
    return null;
  }
}

// ── Discovery: sitemap.xml ────────────────────────────────────────────────────

function parseSitemap(xml: string, baseUrl: string): DocEntry[] {
  const entries: DocEntry[] = [];
  const locRegex = /<loc>(.*?)<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (!isDocUrl(url, baseUrl)) continue;
    const path = urlToRelPath(url, baseUrl);
    const title = path.replace(/\.md$/, "").split("/").pop() ?? path;
    entries.push({ title, url, path });
  }
  return entries;
}

async function trySitemap(
  baseUrl: string,
): Promise<{ entries: DocEntry[]; mode: DiscoveryMode } | null> {
  const sitemapUrl = baseUrl.replace(/\/+$/, "") + "/sitemap.xml";
  console.log(`  Trying ${sitemapUrl}...`);
  try {
    const res = await fetch(sitemapUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.includes("<urlset") && !text.includes("<sitemapindex")) return null;

    let entries: DocEntry[] = [];

    if (text.includes("<sitemapindex")) {
      const sitemapLocs: string[] = [];
      const re = /<loc>(.*?)<\/loc>/gi;
      let m;
      while ((m = re.exec(text)) !== null) sitemapLocs.push(m[1].trim());
      console.log(`  Sitemap index with ${sitemapLocs.length} sub-sitemaps`);
      for (const subUrl of sitemapLocs) {
        try {
          const subRes = await fetch(subUrl, { signal: AbortSignal.timeout(10_000) });
          if (subRes.ok) entries.push(...parseSitemap(await subRes.text(), baseUrl));
        } catch { /* skip */ }
      }
    } else {
      entries = parseSitemap(text, baseUrl);
    }

    if (entries.length === 0) return null;
    console.log(`  Found ${entries.length} entries in sitemap.xml`);
    return { entries, mode: "sitemap" };
  } catch {
    return null;
  }
}

// ── Discovery: crawl (fallback, no deps) ──────────────────────────────────────

function extractLinks(html: string, pageUrl: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], pageUrl).href.split("#")[0];
      links.push(resolved);
    } catch { /* skip */ }
  }
  return [...new Set(links)];
}

async function doCrawl(
  baseUrl: string, maxDepth: number, maxPages: number,
): Promise<{ entries: DocEntry[]; mode: DiscoveryMode }> {
  console.log(`  Crawling from ${baseUrl} (depth=${maxDepth}, max=${maxPages})...`);
  const visited = new Set<string>();
  const entries: DocEntry[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];

  while (queue.length > 0 && entries.length < maxPages) {
    const batch = queue.splice(0, CONCURRENCY);
    const results = await pool(batch, CONCURRENCY, async ({ url, depth }) => {
      if (visited.has(url) || !isDocUrl(url, baseUrl)) return [];
      visited.add(url);
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers: { Accept: "text/html, text/markdown, */*" },
          redirect: "follow",
        });
        if (!res.ok) return [];
        const text = await res.text();
        const path = urlToRelPath(url, baseUrl);
        const titleMatch = text.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch?.[1] ?? path.replace(/\.md$/, "").split("/").pop() ?? path;
        entries.push({ title, url, path });
        if (depth < maxDepth) {
          return extractLinks(text, url)
            .filter((l) => !visited.has(l) && isDocUrl(l, baseUrl))
            .map((l) => ({ url: l, depth: depth + 1 }));
        }
        return [];
      } catch { return []; }
    });
    for (const newLinks of results) queue.push(...newLinks);
    if (entries.length % 25 === 0 && entries.length > 0) {
      process.stdout.write(`\r  Discovered ${entries.length} pages...`);
    }
  }

  if (entries.length > 0) console.log(`\n  Crawled ${entries.length} pages`);
  return { entries, mode: "crawl" };
}

// ── Fetching ──────────────────────────────────────────────────────────────────

async function fetchDoc(
  entry: DocEntry,
): Promise<{ entry: DocEntry; content: string | null; error?: string }> {
  try {
    const res = await fetch(entry.url, {
      headers: { Accept: "text/markdown, text/plain, text/html, */*" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return { entry, content: null, error: `HTTP ${res.status}` };
    let content = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html") && content.includes("<html")) {
      content = stripHtml(content);
    }
    return { entry, content };
  } catch (e: any) {
    return { entry, content: null, error: e.message };
  }
}

function stripHtml(html: string): string {
  const titleMatch = html.match(/<title>(.*?)<\/title>/is);
  const title = titleMatch?.[1]?.trim();
  let body = html;
  const mainMatch = html.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (mainMatch) { body = mainMatch[1]; }
  else {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) body = bodyMatch[1];
  }
  body = body.replace(/<(?:script|style|nav|header|footer)[^>]*>[\s\S]*?<\/(?:script|style|nav|header|footer)>/gi, "");
  body = body.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n");
  body = body.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n");
  body = body.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n");
  body = body.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n#### $1\n");
  body = body.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  body = body.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
  body = body.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");
  body = body.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1");
  body = body.replace(/<\/p>/gi, "\n\n");
  body = body.replace(/<br\s*\/?>/gi, "\n");
  body = body.replace(/<[^>]+>/g, "");
  body = body.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  return title ? `# ${title}\n\n${body}` : body;
}

// ── Index building ────────────────────────────────────────────────────────────

function buildCompressedIndex(entries: DocEntry[]): string {
  const groups = new Map<string, string[]>();
  for (const e of entries) {
    const parts = e.path.split("/");
    const file = parts.pop()!;
    const dir = parts.join("/") || ".";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(file);
  }
  const sortedDirs = [...groups.keys()].sort();
  const sections: string[] = [];
  for (const dir of sortedDirs) {
    const files = groups.get(dir)!.sort();
    sections.push(`${dir}:{${files.join(",")}}`);
  }
  return sections.join("|");
}

function buildIndexBlock(
  name: string, outDir: string, index: string,
  instruction?: string, refreshCmd?: string,
): string {
  const tag = name.toUpperCase();
  const meta = [`[${name} Docs Index]`, `root: ./${outDir}`];
  if (instruction) meta.push(instruction);
  if (refreshCmd) meta.push(`Refresh: ${refreshCmd}`);
  return [
    `<!-- ${tag}-DOCS-START -->`,
    meta.join("|"),
    index,
    `<!-- ${tag}-DOCS-END -->`,
  ].join("\n");
}

// ── Injection ─────────────────────────────────────────────────────────────────

function injectIndex(filePath: string, indexBlock: string, name: string): void {
  const tag = name.toUpperCase();
  const startMarker = `<!-- ${tag}-DOCS-START -->`;
  const endMarker = `<!-- ${tag}-DOCS-END -->`;
  let content: string;
  try { content = readFileSync(filePath, "utf-8"); }
  catch {
    console.log(`  ${filePath} not found, creating it`);
    writeFileSync(filePath, indexBlock + "\n");
    return;
  }
  if (content.includes(startMarker)) {
    const startEsc = startMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const endEsc = endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${startEsc}[\\s\\S]*?${endEsc}`, "m");
    content = content.replace(re, indexBlock);
  } else {
    content = content.trimEnd() + "\n\n" + indexBlock + "\n";
  }
  writeFileSync(filePath, content);
  console.log(`  Injected index into ${filePath}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const urlOrPath = args.url!;
  const requestedMode = (args.mode ?? "firecrawl") as string;

  let baseUrl: string;
  let localContent: string | null = null;

  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    baseUrl = args["base-url"] ?? normalizeBaseUrl(urlOrPath);
  } else {
    if (!existsSync(urlOrPath)) {
      console.error(`File not found: ${urlOrPath}`);
      process.exit(1);
    }
    localContent = readFileSync(urlOrPath, "utf-8");
    if (!args["base-url"]) {
      console.error("--base-url required when using a local file");
      process.exit(1);
    }
    baseUrl = args["base-url"];
  }

  // ── Resolve GitHub repo info ───────────────────────────────────────────
  let repoSlug = args.repo;
  let repoPath = args["repo-path"];
  const repoBranch = args.branch;

  // Auto-detect from --url if it's a GitHub URL
  if (!repoSlug && urlOrPath.includes("github.com")) {
    const parsed = parseGithubUrl(urlOrPath);
    if (parsed) {
      repoSlug = `${parsed.owner}/${parsed.repo}`;
      if (!repoPath && parsed.path) repoPath = parsed.path;
      console.log(`  Auto-detected GitHub repo: ${repoSlug}${repoPath ? ` path: ${repoPath}` : ""}`);
    }
  }

  console.log(`Fetching docs for "${NAME}" from ${repoSlug ? `github:${repoSlug}` : baseUrl}`);
  console.log(`Output: ${OUT_DIR}/\n`);

  // ── Discovery ────────────────────────────────────────────────────────────

  let result: { entries: DocEntry[]; mode: DiscoveryMode } | null = null;

  if (localContent) {
    const entries = parseLlmsTxt(localContent, baseUrl);
    if (entries.length > 0) {
      result = { entries, mode: "llms-txt" };
      console.log(`  Parsed ${entries.length} entries from local file`);
    }
  } else if (requestedMode === "github") {
    if (!repoSlug) {
      console.error("--repo required for github mode (e.g., --repo vercel/next.js)");
      process.exit(1);
    }
    if (!repoPath) {
      console.error("--repo-path required for github mode (e.g., --repo-path docs/)");
      process.exit(1);
    }
    result = await tryGithub(repoSlug, repoPath, repoBranch, MAX_PAGES);
  } else if (requestedMode === "firecrawl") {
    // Try github first if repo info is available
    if (repoSlug && repoPath) {
      console.log("Trying GitHub source files...");
      result = await tryGithub(repoSlug, repoPath, repoBranch, MAX_PAGES);
    }
    // Default: firecrawl scrape links + map, then fallback chain
    if (!result) result = await tryFirecrawl(baseUrl, urlOrPath, MAX_PAGES, args.search);
    if (!result) {
      console.log("  Falling back to llms.txt...");
      result = await tryLlmsTxt(baseUrl);
    }
    if (!result) {
      console.log("  Falling back to sitemap.xml...");
      result = await trySitemap(baseUrl);
    }
    if (!result) {
      console.log("  Falling back to crawl...");
      result = await doCrawl(baseUrl, MAX_DEPTH, MAX_PAGES);
    }
  } else if (requestedMode === "auto") {
    if (urlOrPath.endsWith("llms.txt")) {
      try {
        const res = await fetch(urlOrPath, { signal: AbortSignal.timeout(10_000) });
        if (res.ok) {
          const text = await res.text();
          const entries = parseLlmsTxt(text, baseUrl);
          if (entries.length > 0) {
            result = { entries, mode: "llms-txt" };
            console.log(`  Parsed ${entries.length} entries from ${urlOrPath}`);
          }
        }
      } catch { /* fall through */ }
    }
    if (!result) result = await tryLlmsTxt(baseUrl);
    if (!result) result = await tryFirecrawl(baseUrl, urlOrPath, MAX_PAGES, args.search);
    if (!result) result = await trySitemap(baseUrl);
    if (!result) result = await doCrawl(baseUrl, MAX_DEPTH, MAX_PAGES);
  } else if (requestedMode === "llms-txt") {
    result = await tryLlmsTxt(baseUrl);
  } else if (requestedMode === "sitemap") {
    result = await trySitemap(baseUrl);
  } else if (requestedMode === "crawl") {
    result = await doCrawl(baseUrl, MAX_DEPTH, MAX_PAGES);
  }

  if (!result || result.entries.length === 0) {
    console.error("No documentation pages found. Try a different --mode.");
    process.exit(1);
  }

  if (result.entries.length > MAX_PAGES) {
    console.log(`  Capping from ${result.entries.length} to ${MAX_PAGES} pages`);
    result.entries = result.entries.slice(0, MAX_PAGES);
  }

  console.log(`\nDiscovery complete: ${result.entries.length} pages via ${result.mode}\n`);

  // ── Fetch all docs ───────────────────────────────────────────────────────

  mkdirSync(OUT_DIR, { recursive: true });
  let fetched = 0;
  let failed = 0;
  const errors: string[] = [];

  const fetchResults = await pool(result.entries, CONCURRENCY, async (entry) => {
    const res = await fetchDoc(entry);
    if (res.content !== null) {
      const outPath = join(OUT_DIR, res.entry.path);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, res.content);
      fetched++;
    } else {
      failed++;
      errors.push(`  ${entry.path}: ${res.error}`);
    }
    const total = fetched + failed;
    if (total % 25 === 0) {
      process.stdout.write(`\r  ${total}/${result!.entries.length} fetched...`);
    }
    return res;
  });

  console.log(`\nFetch complete: ${fetched} saved, ${failed} failed`);
  if (errors.length > 0) {
    console.log("Errors:");
    errors.slice(0, 10).forEach((e) => console.log(e));
    if (errors.length > 10) console.log(`  ... and ${errors.length - 10} more`);
  }

  // ── Build index ──────────────────────────────────────────────────────────

  const successEntries = result.entries.filter((_, i) => fetchResults[i]?.content !== null);
  const index = buildCompressedIndex(successEntries);
  const refreshCmd = `npx tsx ~/.claude/skills/fetch-docs/scripts/fetch-docs.ts --url ${urlOrPath} --name ${NAME}`;
  const indexBlock = buildIndexBlock(NAME, OUT_DIR, index, INSTRUCTION, refreshCmd);

  const indexPath = join(OUT_DIR, "_index.txt");
  writeFileSync(indexPath, indexBlock);
  console.log(`\nIndex written to ${indexPath}`);
  console.log(`Index size: ${(indexBlock.length / 1024).toFixed(1)} KB`);

  for (const file of INJECT_FILES) {
    injectIndex(file, indexBlock, NAME);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
