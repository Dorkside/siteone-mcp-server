# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server written in TypeScript that wraps the SiteOne Crawler CLI. Distributed as an npm package for zero-install usage via `npx siteone-mcp-server`. The SiteOne binary must be installed separately on the user's machine.

## Build & Development Commands

- `npm run build` — Compile TypeScript to `dist/` via `tsc`
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
- **Shebang required** — `dist/index.js` must have `#!/usr/bin/env node` for `npx` execution. TypeScript may strip it during compilation; verify with `head -1 dist/index.js` after build
- **Safe process execution** — Always use `execFile` with args array (never `exec` with string interpolation) to prevent command injection
- **Large output handling** — 50MB buffer for crawl results; outputs are truncated (`.slice(0, 2000)`) before returning to prevent overwhelming MCP responses
- **Dynamic timeouts** — Crawl timeout scales with `max_depth` parameter: `Math.max(300_000, max_depth * 60_000)`

## Implementation Reference

`plan.md` contains the complete implementation plan including full source code, package.json, tsconfig.json, publishing checklist, and testing strategy.
