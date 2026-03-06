# siteone-mcp-server

MCP server that wraps the [SiteOne Crawler](https://crawler.siteone.io) CLI for SEO auditing and site analysis. Use it with Claude Code, Claude Desktop, or any MCP-compatible client.

## Prerequisites

[SiteOne Crawler](https://crawler.siteone.io) must be installed on your machine. Download the latest release from [GitHub](https://github.com/janreges/siteone-crawler/releases) and ensure the `crawler` binary is in your PATH.

## Quick Start

### Claude Code

```bash
claude mcp add siteone -- npx -y siteone-mcp-server
```

Or if you need to specify the binary path:

```bash
claude mcp add siteone -e SITEONE_BIN=/path/to/crawler -- npx -y siteone-mcp-server
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

| Environment Variable | Purpose | Default |
|---------------------|---------|---------|
| `SITEONE_BIN` | Path to the SiteOne crawler binary | `crawler` (assumes in PATH) |
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
