#!/usr/bin/env node

// IMPORTANT: Never use console.log() in this file.
// This is a stdio MCP server — stdout is the JSON-RPC transport.
// Use console.error() for debug/diagnostic output only.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

// --- Read version from package.json ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

// --- Configuration via env vars ---
const SITEONE_BIN = process.env.SITEONE_BIN || "crawler";
const SITEONE_OUTPUT_DIR = process.env.SITEONE_OUTPUT_DIR || process.cwd();

// --- Output truncation ---
const MAX_RESULT_LENGTH = 500_000; // 500KB

function truncateResult(result: string): string {
  if (result.length <= MAX_RESULT_LENGTH) return result;
  return (
    result.slice(0, MAX_RESULT_LENGTH) +
    `\n\n[Output truncated: ${result.length} chars total, showing first ${MAX_RESULT_LENGTH}]`
  );
}

// --- Helper: run SiteOne CLI ---
async function runSiteone(
  args: string[],
  timeoutMs: number = 300_000
): Promise<{ output: string; isError: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync(SITEONE_BIN, args, {
      cwd: SITEONE_OUTPUT_DIR,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB — crawl output can be large
    });
    return { output: stdout || stderr, isError: false };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return {
        isError: true,
        output:
          `SiteOne binary not found at '${SITEONE_BIN}'. ` +
          `Install SiteOne (https://crawler.siteone.io) and ensure it's in PATH, ` +
          `or set SITEONE_BIN env var to the correct path.`,
      };
    }
    if (error.killed) {
      return {
        isError: true,
        output: `Crawl timed out after ${timeoutMs / 1000}s`,
      };
    }
    return {
      isError: true,
      output: error.stderr?.trim() || error.message,
    };
  }
}

// --- MCP Server setup ---
const server = new McpServer({
  name: "siteone-crawler",
  version: pkg.version,
});

// --- Tool: crawl_site ---
server.tool(
  "crawl_site",
  "Run a full site crawl with SiteOne Crawler. Returns structured JSON with all crawled URLs and their SEO, performance, and security metrics. Use for comprehensive site audits.",
  {
    url: z
      .string()
      .url()
      .describe("Target URL to crawl (must include protocol)"),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe(
        "Maximum crawl depth (SiteOne default is unlimited; 10 is safer for MCP use)"
      ),
    device: z
      .enum(["desktop", "mobile", "tablet"])
      .default("desktop")
      .describe("Device user agent"),
    workers: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(3)
      .describe("Concurrent workers"),
    max_reqs_per_sec: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe("Max requests per second"),
    timeout: z
      .number()
      .int()
      .min(1)
      .max(60)
      .default(5)
      .describe("Per-request timeout in seconds"),
    disable_javascript: z
      .boolean()
      .default(false)
      .describe("Skip JavaScript resources"),
    disable_styles: z
      .boolean()
      .default(false)
      .describe("Skip CSS resources"),
    disable_images: z
      .boolean()
      .default(false)
      .describe("Skip image resources"),
    extra_columns: z
      .string()
      .default("")
      .describe("Additional columns via XPath or regex"),
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

    const result = await runSiteone(
      args,
      Math.max(300_000, params.max_depth * 60_000)
    );
    return {
      isError: result.isError,
      content: [{ type: "text" as const, text: truncateResult(result.output) }],
    };
  }
);

// --- Tool: crawl_single_page ---
server.tool(
  "crawl_single_page",
  "Analyze a single page with SiteOne Crawler. Returns JSON data for just the specified URL. Fast and lightweight — use for quick page-level audits.",
  {
    url: z.string().url().describe("Target page URL"),
    device: z
      .enum(["desktop", "mobile", "tablet"])
      .default("desktop")
      .describe("Device user agent"),
    extra_columns: z
      .string()
      .default("")
      .describe("Additional columns via XPath or regex"),
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
    return {
      isError: result.isError,
      content: [{ type: "text" as const, text: truncateResult(result.output) }],
    };
  }
);

// --- Tool: generate_sitemap ---
server.tool(
  "generate_sitemap",
  "Crawl a website and generate an XML sitemap file. Returns the path to the generated sitemap.",
  {
    url: z.string().url().describe("Target URL to crawl"),
    output_file: z
      .string()
      .default("sitemap.xml")
      .describe("Output filename for the sitemap"),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe(
        "Maximum crawl depth (SiteOne default is unlimited; 10 is safer for MCP use)"
      ),
  },
  async (params) => {
    const outputPath = join(SITEONE_OUTPUT_DIR, params.output_file);
    const args = [
      `--url=${params.url}`,
      `--max-depth=${params.max_depth}`,
      `--sitemap-xml-file=${outputPath}`,
      "--output=json",
    ];

    const result = await runSiteone(args, 300_000);
    const response = result.isError
      ? result.output
      : JSON.stringify({
          sitemap_path: outputPath,
          crawl_output: truncateResult(result.output),
        });
    return {
      isError: result.isError,
      content: [{ type: "text" as const, text: response }],
    };
  }
);

// --- Tool: export_markdown ---
server.tool(
  "export_markdown",
  "Crawl a website and export all pages as markdown files. Useful for content analysis, migration, or feeding into other AI tools.",
  {
    url: z.string().url().describe("Target URL to crawl"),
    output_dir: z
      .string()
      .default("siteone-markdown-export")
      .describe("Export directory name"),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(5)
      .describe(
        "Maximum crawl depth (SiteOne default is unlimited; 5 is safer for MCP use)"
      ),
  },
  async (params) => {
    const exportPath = join(SITEONE_OUTPUT_DIR, params.output_dir);
    const args = [
      `--url=${params.url}`,
      `--max-depth=${params.max_depth}`,
      `--markdown-export-dir=${exportPath}`,
      "--output=json",
    ];

    const result = await runSiteone(args, 300_000);
    const response = result.isError
      ? result.output
      : JSON.stringify({
          export_path: exportPath,
          crawl_output: truncateResult(result.output),
        });
    return {
      isError: result.isError,
      content: [{ type: "text" as const, text: response }],
    };
  }
);

// --- Tool: get_crawl_summary ---
server.tool(
  "get_crawl_summary",
  "Run a quick shallow crawl and return summary statistics — status codes, response times, error counts. Good for fast health checks.",
  {
    url: z.string().url().describe("Target URL to crawl"),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe("Shallow crawl depth"),
    rows_limit: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(500)
      .describe("Max URLs to process (SiteOne default is 200)"),
  },
  async (params) => {
    const args = [
      `--url=${params.url}`,
      `--max-depth=${params.max_depth}`,
      `--rows-limit=${params.rows_limit}`,
      "--output=json",
    ];

    const result = await runSiteone(args, 120_000);
    return {
      isError: result.isError,
      content: [{ type: "text" as const, text: truncateResult(result.output) }],
    };
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
