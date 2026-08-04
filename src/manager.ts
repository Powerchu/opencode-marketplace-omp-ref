import fs from "node:fs/promises";
import path from "node:path";
import { fetchMarketplace } from "./fetcher";
import {
  addInstalledPlugin,
  addMarketplaceEntry,
  getInstalledPlugin,
  getMarketplaceEntry,
  readInstalledPluginsRegistry,
  readMarketplacesRegistry,
  removeInstalledPlugin,
  removeMarketplaceEntry,
  writeInstalledPluginsRegistry,
  writeMarketplacesRegistry,
} from "./registry";
import { resolvePluginSource } from "./source-resolver";
import type {
  InstalledPluginSummary,
  MarketplaceCatalog,
  MarketplaceRegistryEntry,
} from "./types";
import { buildPluginId, parsePluginId } from "./types";

export interface MarketplaceManagerOptions {
  marketplacesRegistryPath: string;
  installedRegistryPath: string;
  projectInstalledRegistryPath?: string;
  marketplacesCacheDir: string;
  pluginsCacheDir: string;
}

export class MarketplaceManager {
  #opts: MarketplaceManagerOptions;

  constructor(options: MarketplaceManagerOptions) {
    this.#opts = options;
  }

  async addMarketplace(source: string): Promise<MarketplaceRegistryEntry> {
    const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
    const { catalog, sourceType, sourceUri, catalogPath } = await fetchMarketplace(
      source,
      this.#opts.marketplacesCacheDir
    );

    const now = new Date().toISOString();
    const entry: MarketplaceRegistryEntry = {
      name: catalog.name,
      sourceType,
      sourceUri,
      catalogPath,
      addedAt: now,
      updatedAt: now,
    };

    const updatedReg = addMarketplaceEntry(reg, entry);
    await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updatedReg);
    return entry;
  }

  async removeMarketplace(name: string): Promise<void> {
    const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
    const updatedReg = removeMarketplaceEntry(reg, name);
    await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updatedReg);
  }

  async listMarketplaces(): Promise<MarketplaceRegistryEntry[]> {
    const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
    return reg.marketplaces;
  }

  async fetchCatalog(name: string): Promise<MarketplaceCatalog> {
    const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
    const entry = getMarketplaceEntry(reg, name);
    if (!entry) {
      throw new Error(`Marketplace "${name}" is not registered. Run /marketplace add <source> first.`);
    }

    const { catalog } = await fetchMarketplace(entry.sourceUri, this.#opts.marketplacesCacheDir);
    return catalog;
  }

  async installPlugin(
    pluginName: string,
    marketplaceName: string,
    options: { scope?: "user" | "project"; force?: boolean } = {}
  ): Promise<string> {
    const catalog = await this.fetchCatalog(marketplaceName);
    const pluginEntry = catalog.plugins.find((p) => p.name.toLowerCase() === pluginName.toLowerCase());
    if (!pluginEntry) {
      throw new Error(`Plugin "${pluginName}" not found in marketplace "${marketplaceName}".`);
    }

    const pluginId = buildPluginId(pluginEntry.name, catalog.name);
    const marketplaceRoot = path.dirname(this.#opts.marketplacesCacheDir);
    const resolvedPath = await resolvePluginSource(pluginEntry.source, {
      marketplaceRoot,
      cacheDir: this.#opts.pluginsCacheDir,
    });

    const scope = options.scope || "user";
    const registryPath =
      scope === "project" && this.#opts.projectInstalledRegistryPath
        ? this.#opts.projectInstalledRegistryPath
        : this.#opts.installedRegistryPath;

    const registry = await readInstalledPluginsRegistry(registryPath);
    const now = new Date().toISOString();

    const updatedRegistry = addInstalledPlugin(registry, pluginId, {
      scope,
      installPath: resolvedPath,
      version: pluginEntry.version || "1.0.0",
      installedAt: now,
      lastUpdated: now,
      enabled: true,
    });

    await writeInstalledPluginsRegistry(registryPath, updatedRegistry);
    return pluginId;
  }

  async uninstallPlugin(
    pluginId: string,
    options: { scope?: "user" | "project" } = {}
  ): Promise<void> {
    const scope = options.scope || "user";
    const registryPath =
      scope === "project" && this.#opts.projectInstalledRegistryPath
        ? this.#opts.projectInstalledRegistryPath
        : this.#opts.installedRegistryPath;

    const registry = await readInstalledPluginsRegistry(registryPath);
    const updatedRegistry = removeInstalledPlugin(registry, pluginId, scope);
    await writeInstalledPluginsRegistry(registryPath, updatedRegistry);
  }

  async listInstalledPlugins(): Promise<InstalledPluginSummary[]> {
    const userReg = await readInstalledPluginsRegistry(this.#opts.installedRegistryPath);
    const projectReg = this.#opts.projectInstalledRegistryPath
      ? await readInstalledPluginsRegistry(this.#opts.projectInstalledRegistryPath)
      : { version: 2, plugins: {} };

    const summaries: InstalledPluginSummary[] = [];

    for (const [id, entries] of Object.entries(projectReg.plugins)) {
      summaries.push({ id, scope: "project", entries });
    }

    for (const [id, entries] of Object.entries(userReg.plugins)) {
      const existsInProject = Boolean(projectReg.plugins[id]);
      summaries.push({
        id,
        scope: "user",
        entries,
        shadowedBy: existsInProject ? "project" : undefined,
      });
    }

    return summaries;
  }
}
