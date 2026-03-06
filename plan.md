# SiteOne Crawler MCP Server — Implementation Plan

## Goal

Build and publish an open-source **npm package** (`siteone-mcp-server`) in TypeScript that wraps the SiteOne Crawler CLI as an MCP server. Users can run it instantly via `npx` with zero config in Claude Code, Claude Desktop, or any MCP-compatible client. The SiteOne binary must already be installed on the user's machine; the MCP server simply provides a structured interface to it.

---

## Architecture Decision: TypeScript + npm (not Python)

Since the target distribution is `npx siteone-mcp-server`, we use TypeScript with the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) and publish to npm. This gives us:

- Zero-install usage via `npx`
- Native stdio transport (what Claude Code expects)
- Familiar toolchain for the MCP ecosystem (most MCP servers are TypeScript)
- Clean `bin` entry for CLI execution

---

## Project Structure

```
siteone-mcp-server/
├── src/
│   └── index.ts           # Main MCP server — tool definitions + SiteOne CLI wrapper
├── dist/                   # Compiled JS output (gitignored, included in npm package)
│   └── index.js
├── package.json            # npm package config with bin entry
├── tsconfig.json           # TypeScript configuration
├── README.md               # Usage docs, Claude Code config examples
├── LICENSE                 # MIT license
└── .gitignore
```

---

## package.json

```json
{
  "name": "siteone-mcp-server",
  "version": "1.0.0",
  "description": "MCP server wrapping SiteOne Crawler CLI for SEO auditing and site analysis",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "siteone-mcp-server": "./dist/index.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "prepublishOnly": "npm run build",
    "inspect": "npx @modelcontextprotocol/inspector node dist/index.js"
  },
  "keywords": [
    "mcp",
    "siteone",
    "crawler",
    "seo",
    "model-context-protocol",
    "claude"
  ],
  "author": "James Martin <contact@james-martin.dev>",
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"]
}
```

---

## Tool Definitions

The MCP server exposes 5 tools mapping to SiteOne CLI capabilities:

### 1. `crawl_site` — Full site crawl

Run a comprehensive crawl and return JSON results.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` (required) | — | Target URL (http/https or sitemap XML) |
| `max_depth` | `number` | `10` | Maximum crawl depth |
| `device` | `enum` | `"desktop"` | `desktop`, `mobile`, or `tablet` |
| `workers` | `number` | `3` | Concurrent workers |
| `max_reqs_per_sec` | `number` | `10` | Rate limit |
| `timeout` | `number` | `5` | Per-request timeout (seconds) |
| `disable_javascript` | `boolean` | `false` | Skip JS resources |
| `disable_styles` | `boolean` | `false` | Skip CSS resources |
| `disable_images` | `boolean` | `false` | Skip image resources |
| `extra_columns` | `string` | `""` | XPath/regex for extra data extraction |

### 2. `crawl_single_page` — Analyze one page

Quick single-page audit. Same as above but with `--single-page` flag, fewer params.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` (required) | — | Target page URL |
| `device` | `enum` | `"desktop"` | User agent device |
| `extra_columns` | `string` | `""` | XPath/regex for extra data |

### 3. `generate_sitemap` — Export sitemap

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` (required) | — | Target URL |
| `output_file` | `string` | `"./sitemap.xml"` | Output file path |
| `max_depth` | `number` | `10` | Crawl depth |

### 4. `export_markdown` — Export site as markdown

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` (required) | — | Target URL |
| `output_dir` | `string` | `"./siteone-markdown-export"` | Export directory |
| `max_depth` | `number` | `5` | Crawl depth |

### 5. `get_crawl_summary` — Quick health check

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` (required) | — | Target URL |
| `max_depth` | `number` | `3` | Shallow crawl depth |
| `rows_limit` | `number` | `500` | Max URLs to process |

---

## Implementation: `src/index.ts`

```typescript
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// --- Configuration via env vars ---
const SITEONE_BIN = process.env.SITEONE_BIN || "crawler";
const SITEONE_OUTPUT_DIR = process.env.SITEONE_OUTPUT_DIR || process.cwd();

// --- Helper: run SiteOne CLI ---
async function runSiteone(
  args: string[],
  timeoutMs: number = 300_000
): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(SITEONE_BIN, args, {
      cwd: SITEONE_OUTPUT_DIR,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB — crawl output can be large
    });
    return stdout || stderr;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return JSON.stringify({
        error: true,
        message: `SiteOne binary not found at '${SITEONE_BIN}'. ` +
          `Install SiteOne (https://crawler.siteone.io) and ensure it's in PATH, ` +
          `or set SITEONE_BIN env var to the correct path.`,
      });
    }
    if (error.killed) {
      return JSON.stringify({
        error: true,
        message: `Crawl timed out after ${timeoutMs / 1000}s`,
      });
    }
    return JSON.stringify({
      error: true,
      message: error.stderr?.trim() || error.message,
      stdout: error.stdout?.trim()?.slice(0, 2000),
    });
  }
}

// --- MCP Server setup ---
const server = new McpServer({
  name: "siteone-crawler",
  version: "1.0.0",
});

// --- Tool: crawl_site ---
server.tool(
  "crawl_site",
  "Run a full site crawl with SiteOne Crawler. Returns structured JSON with all crawled URLs and their SEO, performance, and security metrics. Use for comprehensive site audits.",
  {
    url: z.string().url().describe("Target URL to crawl (must include protocol)"),
    max_depth: z.number().int().min(1).max(100).default(10).describe("Maximum crawl depth"),
    device: z.enum(["desktop", "mobile", "tablet"]).default("desktop").describe("Device user agent"),
    workers: z.number().int().min(1).max(20).default(3).describe("Concurrent workers"),
    max_reqs_per_sec: z.number().int().min(1).max(100).default(10).describe("Max requests per second"),
    timeout: z.number().int().min(1).max(60).default(5).describe("Per-request timeout in seconds"),
    disable_javascript: z.boolean().default(false).describe("Skip JavaScript resources"),
    disable_styles: z.boolean().default(false).describe("Skip CSS resources"),
    disable_images: z.boolean().default(false).describe("Skip image resources"),
    extra_columns: z.string().default("").describe("Additional columns via XPath or regex"),
  },
  async (params) => {
    const args = [
      `--url=${params.url}`,
      `--max-depth=${params.max_depth}`,
      `--device=${params.device}`,
      `--workers=${params.workers}`,
      `--max-reqs-per-sec=${params.max_reqs_per_sec}`,
      `--timeout=${params.timeout}`,
      "--output=json",
    ];
    if (params.disable_javascript) args.push("--disable-javascript");
    if (params.disable_styles) args.push("--disable-styles");
    if (params.disable_images) args.push("--disable-images");
    if (params.extra_columns) args.push(`--extra-columns=${params.extra_columns}`);

    const result = await runSiteone(args, Math.max(300_000, params.max_depth * 60_000));
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Tool: crawl_single_page ---
server.tool(
  "crawl_single_page",
  "Analyze a single page with SiteOne Crawler. Returns JSON data for just the specified URL. Fast and lightweight — use for quick page-level audits.",
  {
    url: z.string().url().describe("Target page URL"),
    device: z.enum(["desktop", "mobile", "tablet"]).default("desktop").describe("Device user agent"),
    extra_columns: z.string().default("").describe("Additional columns via XPath or regex"),
  },
  async (params) => {
    const args = [
      `--url=${params.url}`,
      "--single-page",
      `--device=${params.device}`,
      "--output=json",
    ];
    if (params.extra_columns) args.push(`--extra-columns=${params.extra_columns}`);

    const result = await runSiteone(args, 60_000);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Tool: generate_sitemap ---
server.tool(
  "generate_sitemap",
  "Crawl a website and generate an XML sitemap file. Returns the path to the generated sitemap.",
  {
    url: z.string().url().describe("Target URL to crawl"),
    output_file: z.string().default("sitemap.xml").describe("Output filename for the sitemap"),
    max_depth: z.number().int().min(1).max(100).default(10).describe("Maximum crawl depth"),
  },
  async (params) => {
    const outputPath = `${SITEONE_OUTPUT_DIR}/${params.output_file}`;
    const args = [
      `--url=${params.url}`,
      `--max-depth=${params.max_depth}`,
      `--sitemap-xml-file=${outputPath}`,
      "--output=json",
    ];

    const result = await runSiteone(args, 300_000);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ sitemap_path: outputPath, crawl_output: result.slice(0, 2000) }),
      }],
    };
  }
);

// --- Tool: export_markdown ---
server.tool(
  "export_markdown",
  "Crawl a website and export all pages as markdown files. Useful for content analysis, migration, or feeding into other AI tools.",
  {
    url: z.string().url().describe("Target URL to crawl"),
    output_dir: z.string().default("siteone-markdown-export").describe("Export directory name"),
    max_depth: z.number().int().min(1).max(50).default(5).describe("Maximum crawl depth"),
  },
  async (params) => {
    const exportPath = `${SITEONE_OUTPUT_DIR}/${params.output_dir}`;
    const args = [
      `--url=${params.url}`,
      `--max-depth=${params.max_depth}`,
      `--markdown-export-dir=${exportPath}`,
      "--output=json",
    ];

    const result = await runSiteone(args, 300_000);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ export_path: exportPath, crawl_output: result.slice(0, 2000) }),
      }],
    };
  }
);

// --- Tool: get_crawl_summary ---
server.tool(
  "get_crawl_summary",
  "Run a quick shallow crawl and return summary statistics — status codes, response times, error counts. Good for fast health checks.",
  {
    url: z.string().url().describe("Target URL to crawl"),
    max_depth: z.number().int().min(1).max(10).default(3).describe("Shallow crawl depth"),
    rows_limit: z.number().int().min(1).max(10000).default(500).describe("Max URLs to process"),
  },
  async (params) => {
    const args = [
      `--url=${params.url}`,
      `--max-depth=${params.max_depth}`,
      `--rows-limit=${params.rows_limit}`,
      "--output=json",
    ];

    const result = await runSiteone(args, 120_000);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

---

## Usage: Claude Code Configuration

After publishing, users add this to their Claude Code MCP config (`~/.claude/mcp_settings.json`):

```json
{
  "mcpServers": {
    "siteone": {
      "command": "npx",
      "args": ["-y", "siteone-mcp-server"],
      "env": {
        "SITEONE_BIN": "/path/to/crawler"
      }
    }
  }
}
```

Or if `crawler` is already in PATH, simply:

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

## Usage: Claude Desktop Configuration

Same config in Claude Desktop's settings under "MCP Servers":

```json
{
  "mcpServers": {
    "siteone": {
      "command": "npx",
      "args": ["-y", "siteone-mcp-server"],
      "env": {
        "SITEONE_BIN": "/path/to/crawler"
      }
    }
  }
}
```

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `SITEONE_BIN` | Path to the SiteOne crawler binary | `crawler` (assumes in PATH) |
| `SITEONE_OUTPUT_DIR` | Working directory for crawl outputs | `process.cwd()` |

---

## npm Publishing Checklist

### First-time setup

1. Create an npm account at https://www.npmjs.com if you don't have one
2. Login locally: `npm login`
3. Verify the package name `siteone-mcp-server` is available: `npm view siteone-mcp-server` (should return 404)

### Build & Publish

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript
npm run build

# 3. Verify the shebang is present in dist/index.js
head -1 dist/index.js
# Should output: #!/usr/bin/env node

# 4. Test locally before publishing
node dist/index.js  # Should start and wait for stdio input (Ctrl+C to exit)

# 5. Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# 6. Do a dry run to see what will be published
npm pack --dry-run

# 7. Publish
npm publish --access public

# 8. Verify it works via npx
npx siteone-mcp-server
```

### Important: Shebang handling

TypeScript won't preserve the `#!/usr/bin/env node` shebang from `src/index.ts` in all configurations. If `tsc` strips it, add a `prepublishOnly` script that prepends it:

```json
{
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build && echo '#!/usr/bin/env node' | cat - dist/index.js > dist/tmp.js && mv dist/tmp.js dist/index.js"
  }
}
```

Alternatively, use a bundler like `tsup` which handles shebangs natively:

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm --banner.js '#!/usr/bin/env node'"
  },
  "devDependencies": {
    "tsup": "^8.0.0"
  }
}
```

---

## Testing Plan

### 1. Unit: Verify SiteOne CLI works

```bash
crawler --url=https://example.com --single-page --output=json
```

### 2. Integration: MCP Inspector

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

This opens a browser UI where you can test each tool interactively, see the JSON schemas, and verify responses.

### 3. End-to-end: npx in Claude Code

After publishing:

```bash
claude mcp add siteone -- npx -y siteone-mcp-server
```

Then in Claude Code, ask: "Use SiteOne to crawl https://example.com and give me a summary"

---

## Security Considerations

- The server only executes the SiteOne binary via `execFile` (not `exec`) — no shell interpolation
- All parameters are passed as CLI flags in an array, preventing command injection
- Rate limiting defaults (`--max-reqs-per-sec=10`) prevent accidental DoS
- Timeouts prevent runaway crawls
- No network credentials are handled — SiteOne crawls public URLs
- The binary path is configurable but defaults to a safe value

---

## README.md Outline

The README should cover:

1. **One-liner description** — what it does
2. **Prerequisites** — SiteOne must be installed locally
3. **Quick start** — `npx` config for Claude Code (3 lines)
4. **Available tools** — table of all 5 tools with descriptions
5. **Configuration** — env vars, Claude Desktop config
6. **Examples** — sample prompts and expected behavior
7. **Contributing** — how to develop locally
8. **License** — MIT

---

## Step-by-Step Implementation Order

When starting a Claude Code session, execute in this order:

1. **Scaffold the project:**
   ```bash
   mkdir siteone-mcp-server && cd siteone-mcp-server
   npm init -y
   npm install @modelcontextprotocol/sdk zod
   npm install -D typescript @types/node tsup
   ```

2. **Create `tsconfig.json`** (see config above)

3. **Create `src/index.ts`** (see full implementation above)

4. **Update `package.json`** with correct `bin`, `files`, `scripts`, `type: "module"` fields

5. **Build and test locally:**
   ```bash
   npm run build
   npx @modelcontextprotocol/inspector node dist/index.js
   ```

6. **Test each tool** in the Inspector against a real URL

7. **Write README.md**

8. **Create `.gitignore`** (node_modules, dist)

9. **Create GitHub repo and push**

10. **Publish to npm:**
    ```bash
    npm login
    npm publish --access public
    ```

11. **Verify end-to-end:**
    ```bash
    claude mcp add siteone -- npx -y siteone-mcp-server
    ```

---

## Future Enhancements

- **Scheduled crawls** — Pair with Claude scheduled tasks for weekly audits
- **Diff reports** — Compare two crawl runs to detect regressions
- **HTML report tool** — Return rich HTML reports alongside JSON
- **DataForSeo integration** — Cross-reference crawl findings with keyword/backlink data
- **Result caching** — Store and serve repeat queries from cache
- **Scoped npm package** — Consider `@james-martin/siteone-mcp-server` if the unscoped name is taken
