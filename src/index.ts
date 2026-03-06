// IMPORTANT: Never use console.log() in this file.
// This is a stdio MCP server — stdout is the JSON-RPC transport.
// Use console.error() for debug/diagnostic output only.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import https from "node:https";
import http from "node:http";

const execFileAsync = promisify(execFile);

// --- Read version from package.json ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

// --- SiteOne Crawler auto-install ---
const SITEONE_VERSION = "1.0.9";
const INSTALL_DIR = join(homedir(), ".siteone-crawler");

function resolveSiteoneBin(): string {
  // 1. --siteone-bin CLI arg (parsed in main, stored here)
  const cliArg = process.argv
    .slice(2)
    .find((a) => a.startsWith("--siteone-bin="));
  if (cliArg) return cliArg.split("=").slice(1).join("=");

  // 2. SITEONE_BIN env var
  if (process.env.SITEONE_BIN) return process.env.SITEONE_BIN;

  // 3. ~/.siteone-crawler/crawler (auto-installed location)
  const autoInstalled = join(INSTALL_DIR, "crawler");
  if (existsSync(autoInstalled)) return autoInstalled;

  // 4. Fall back to PATH lookup
  return "crawler";
}

function getPlatformAsset(): { filename: string; archiveType: "tar.gz" } {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32") {
    console.error(
      "Windows is not yet supported by the auto-installer.\n" +
        "Please download SiteOne Crawler manually from https://crawler.siteone.io\n" +
        "and set --siteone-bin=/path/to/crawler or SITEONE_BIN env var."
    );
    process.exit(1);
  }

  let platformStr: string;
  let archStr: string;

  if (platform === "darwin") {
    platformStr = "macos";
  } else if (platform === "linux") {
    platformStr = "linux";
  } else {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
  }

  if (arch === "arm64") {
    archStr = "arm64";
  } else if (arch === "x64") {
    archStr = "x64";
  } else {
    console.error(`Unsupported architecture: ${arch}`);
    process.exit(1);
  }

  const filename = `siteone-crawler-v${SITEONE_VERSION}-${platformStr}-${archStr}.tar.gz`;
  return { filename, archiveType: "tar.gz" };
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const request = (url.startsWith("https") ? https : http).get(
      url,
      (response) => {
        // Follow redirects (GitHub releases redirect to S3)
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          unlinkSync(dest);
          downloadFile(response.headers.location, dest).then(resolve, reject);
          return;
        }

        if (response.statusCode && response.statusCode !== 200) {
          file.close();
          unlinkSync(dest);
          reject(
            new Error(`Download failed with status ${response.statusCode}`)
          );
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      }
    );
    request.on("error", (err) => {
      file.close();
      unlinkSync(dest);
      reject(err);
    });
  });
}

async function installSiteone(): Promise<void> {
  const { filename } = getPlatformAsset();
  const downloadUrl = `https://github.com/janreges/siteone-crawler/releases/download/v${SITEONE_VERSION}/${filename}`;

  console.error(`Installing SiteOne Crawler v${SITEONE_VERSION}...`);
  console.error(`Platform: ${process.platform}/${process.arch}`);
  console.error(`Download: ${downloadUrl}`);

  // Create install directory
  mkdirSync(INSTALL_DIR, { recursive: true });

  const archivePath = join(INSTALL_DIR, filename);

  // Download
  console.error("Downloading...");
  await downloadFile(downloadUrl, archivePath);
  console.error("Download complete.");

  // Extract
  console.error("Extracting...");
  execFileSync("tar", ["xzf", archivePath, "-C", INSTALL_DIR]);

  // The archive extracts to a subdirectory like siteone-crawler-v1.0.9-macos-arm64/
  // Move its contents to INSTALL_DIR directly
  const extractedDirName = filename.replace(".tar.gz", "");
  const extractedDir = join(INSTALL_DIR, extractedDirName);

  if (existsSync(extractedDir)) {
    const entries = readdirSync(extractedDir);
    for (const entry of entries) {
      const src = join(extractedDir, entry);
      const dest = join(INSTALL_DIR, entry);
      // Remove existing entry if present (for upgrades)
      if (existsSync(dest)) {
        execFileSync("rm", ["-rf", dest]);
      }
      renameSync(src, dest);
    }
    // Remove the now-empty extracted directory
    execFileSync("rm", ["-rf", extractedDir]);
  }

  // Clean up the archive
  unlinkSync(archivePath);

  // Ensure the crawler script is executable
  const crawlerPath = join(INSTALL_DIR, "crawler");
  if (existsSync(crawlerPath)) {
    chmodSync(crawlerPath, 0o755);
  }

  console.error(`\nSiteOne Crawler installed to ${INSTALL_DIR}`);
  console.error(
    `Binary: ${crawlerPath}\n`
  );
  console.error(
    "The MCP server will auto-detect this installation — no configuration needed."
  );
}

// --- Configuration ---
const SITEONE_BIN = resolveSiteoneBin();
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
  const args = process.argv.slice(2);

  if (args.includes("--install")) {
    await installSiteone();
    process.exit(0);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
