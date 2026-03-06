# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server written in TypeScript that wraps the SiteOne Crawler CLI. Distributed as an npm package for zero-install usage via `npx siteone-mcp-server`. The SiteOne binary must be installed separately on the user's machine.

## Build & Development Commands

- `npm run build` — Bundle with `tsup` to `dist/` (config in `tsup.config.ts`, handles shebang automatically)
- `npm run dev` — Watch mode for development
- `npm run inspect` — Test with MCP Inspector (opens browser UI for interactive tool testing)
- `npm pack --dry-run` — Preview what will be published to npm

No test suite or linter is configured yet.

## Architecture

**Single-file MCP server** (`src/index.ts`) — all tool definitions and CLI wrapper logic in one file.

### Key Components

- **MCP Server**: Uses `@modelcontextprotocol/sdk` with `StdioServerTransport` for Claude Code/Desktop integration
- **CLI Wrapper**: `runSiteone()` helper uses Node's `execFile` (not `exec`) with promisified async/await to safely invoke the SiteOne binary
- **Tool Definitions**: 5 tools registered via `server.tool()` with Zod schemas for parameter validation:
  - `crawl_site` — Full site crawl with JSON output
  - `crawl_single_page` — Single page analysis
  - `generate_sitemap` — XML sitemap generation
  - `export_markdown` — Export pages as markdown files
  - `get_crawl_summary` — Quick shallow health check

### Environment Variables

- `SITEONE_BIN` — Path to SiteOne binary (default: `crawler`, assumes in PATH)
- `SITEONE_OUTPUT_DIR` — Working directory for crawl outputs (default: `process.cwd()`)

## Key Conventions

- **ES modules** — `"type": "module"` in package.json, Node16 module resolution
- **Shebang required** — `dist/index.js` must have `#!/usr/bin/env node` for `npx` execution. `tsup.config.ts` handles this via the `banner` option; verify with `head -1 dist/index.js` after build
- **No console.log** — This is a stdio MCP server; stdout is the JSON-RPC transport. Use `console.error()` for diagnostics only.
- **Safe process execution** — Always use `execFile` with args array (never `exec` with string interpolation) to prevent command injection
- **MCP error responses** — Return `{ isError: true, content: [...] }` for errors so clients can distinguish failures from normal output
- **Output truncation** — 50MB buffer for crawl results; `truncateResult()` caps output at 100KB before returning to the MCP client
- **Output transformation** — `transformSiteoneOutput()` strips column metadata and internal fields for audit tools; `summarizeSiteoneOutput()` keeps only actionable data for health-check and file-output tools
- **Dynamic timeouts** — Crawl timeout scales with `max_depth` parameter across all crawl tools: `Math.max(300_000, max_depth * 60_000)`
- **Default divergences from SiteOne CLI** — `max_depth` defaults to 10 (SiteOne default is unlimited), `rows_limit` defaults to 500 (SiteOne default is 200). These are intentionally safer for MCP use.
