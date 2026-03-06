# siteone-mcp-server

MCP server that wraps the [SiteOne Crawler](https://crawler.siteone.io) CLI for SEO auditing and site analysis. Use it with Claude Code, Claude Desktop, or any MCP-compatible client.

## Install SiteOne Crawler

The auto-installer downloads the correct SiteOne Crawler binary for your platform:

```bash
npx -y siteone-mcp-server --install
```

This installs to `~/.siteone-crawler/` and the MCP server will auto-detect it — no further configuration needed.

Supports macOS (arm64, x64) and Linux (arm64, x64). Windows users should [download manually](https://github.com/janreges/siteone-crawler/releases).

## Quick Start

### Claude Code

```bash
claude mcp add siteone -- npx -y siteone-mcp-server
```

### Claude Desktop

Add to your MCP settings (`~/.claude/mcp_settings.json`):

```json
{
  "mcpServers": {
    "siteone": {
      "command": "npx",
      "args": ["-y", "siteone-mcp-server"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `crawl_site` | Full site crawl — returns JSON with SEO, performance, and security metrics for all URLs |
| `crawl_single_page` | Single page analysis — fast, lightweight audit of one URL |
| `generate_sitemap` | Crawl a site and generate an XML sitemap file |
| `export_markdown` | Crawl a site and export all pages as markdown files |
| `get_crawl_summary` | Quick shallow crawl for health check statistics |

## Configuration

The server resolves the SiteOne binary in this order:

1. `--siteone-bin` CLI argument (highest priority)
2. `SITEONE_BIN` environment variable
3. `~/.siteone-crawler/crawler` (auto-installed location)
4. `crawler` in PATH (fallback)

### CLI argument

```bash
claude mcp add siteone -- npx -y siteone-mcp-server --siteone-bin=/path/to/crawler
```

Or in Claude Desktop config:

```json
{
  "mcpServers": {
    "siteone": {
      "command": "npx",
      "args": ["-y", "siteone-mcp-server", "--siteone-bin=/path/to/crawler"]
    }
  }
}
```

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `SITEONE_BIN` | Path to the SiteOne crawler binary | Auto-detected (see above) |
| `SITEONE_OUTPUT_DIR` | Working directory for crawl outputs | Current working directory |

## Examples

Once configured, ask Claude:

- "Crawl https://example.com and summarize the SEO issues"
- "Check if https://example.com has any broken links"
- "Generate a sitemap for https://example.com"
- "Export https://example.com as markdown"
- "Give me a quick health check of https://example.com"

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Test with MCP Inspector
npm run inspect
```

## License

MIT
