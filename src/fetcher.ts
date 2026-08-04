import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { MarketplaceCatalog, MarketplaceSourceType } from "./types";

export interface FetchMarketplaceResult {
  catalog: MarketplaceCatalog;
  sourceType: MarketplaceSourceType;
  sourceUri: string;
  catalogPath: string;
  clonePath?: string;
}

export function classifySource(source: string): { type: MarketplaceSourceType; uri: string } {
  if (source.startsWith("./") || source.startsWith("../") || path.isAbsolute(source)) {
    return { type: "local", uri: path.resolve(source) };
  }
  if (source.startsWith("http://") || source.startsWith("https://") || source.endsWith(".git")) {
    return { type: "url", uri: source };
  }
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(source)) {
    return { type: "github", uri: `https://github.com/${source}.git` };
  }
  return { type: "git", uri: source };
}

export async function fetchMarketplace(
  source: string,
  cacheDir: string
): Promise<FetchMarketplaceResult> {
  const { type, uri } = classifySource(source);

  if (type === "local") {
    const catalogPath = await findCatalogInDir(uri);
    const raw = await fs.readFile(catalogPath, "utf-8");
    const catalog = parseMarketplaceCatalog(raw);
    return {
      catalog,
      sourceType: "local",
      sourceUri: uri,
      catalogPath,
    };
  }

  // Git / GitHub / URL
  const targetDirName = uri.replace(/[^a-zA-Z0-9_-]/g, "_");
  const targetPath = path.join(cacheDir, targetDirName);

  await fs.mkdir(cacheDir, { recursive: true });

  try {
    if (await dirExists(targetPath)) {
      execSync(`git -C "${targetPath}" pull --quiet`, { stdio: "ignore" });
    } else {
      execSync(`git clone --depth 1 "${uri}" "${targetPath}" --quiet`, { stdio: "ignore" });
    }
  } catch (err: any) {
    throw new Error(`Failed to clone/pull marketplace repository "${uri}": ${err?.message || err}`);
  }

  const catalogPath = await findCatalogInDir(targetPath);
  const raw = await fs.readFile(catalogPath, "utf-8");
  const catalog = parseMarketplaceCatalog(raw);

  return {
    catalog,
    sourceType: type,
    sourceUri: uri,
    catalogPath,
    clonePath: targetPath,
  };
}

async function findCatalogInDir(dir: string): Promise<string> {
  const candidates = [
    path.join(dir, ".omp-plugin", "marketplace.json"),
    path.join(dir, ".claude-plugin", "marketplace.json"),
    path.join(dir, "marketplace.json"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`No marketplace.json found in "${dir}". Expected .omp-plugin/marketplace.json or .claude-plugin/marketplace.json`);
}

export function parseMarketplaceCatalog(rawJson: string): MarketplaceCatalog {
  const json = JSON.parse(rawJson);
  if (!json || typeof json.name !== "string" || !Array.isArray(json.plugins)) {
    throw new Error("Invalid marketplace.json manifest structure. Required fields: name, plugins[]");
  }
  return json;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
