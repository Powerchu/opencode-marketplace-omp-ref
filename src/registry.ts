import fs from "node:fs/promises";
import path from "node:path";
import type {
  InstalledPluginEntry,
  InstalledPluginsRegistry,
  MarketplaceRegistryEntry,
  MarketplacesRegistry,
} from "./types";

export async function readMarketplacesRegistry(registryPath: string): Promise<MarketplacesRegistry> {
  try {
    const raw = await fs.readFile(registryPath, "utf-8");
    const json = JSON.parse(raw);
    if (json && json.version === 1 && Array.isArray(json.marketplaces)) {
      return json;
    }
  } catch {}
  return { version: 1, marketplaces: [] };
}

export async function writeMarketplacesRegistry(
  registryPath: string,
  registry: MarketplacesRegistry
): Promise<void> {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

export async function readInstalledPluginsRegistry(
  registryPath: string
): Promise<InstalledPluginsRegistry> {
  try {
    const raw = await fs.readFile(registryPath, "utf-8");
    const json = JSON.parse(raw);
    if (json && (json.version === 2 || json.version === 1) && json.plugins) {
      return { version: 2, plugins: json.plugins };
    }
  } catch {}
  return { version: 2, plugins: {} };
}

export async function writeInstalledPluginsRegistry(
  registryPath: string,
  registry: InstalledPluginsRegistry
): Promise<void> {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

export function getMarketplaceEntry(
  registry: MarketplacesRegistry,
  name: string
): MarketplaceRegistryEntry | undefined {
  return registry.marketplaces.find((m) => m.name.toLowerCase() === name.toLowerCase());
}

export function addMarketplaceEntry(
  registry: MarketplacesRegistry,
  entry: MarketplaceRegistryEntry
): MarketplacesRegistry {
  const updated = registry.marketplaces.filter(
    (m) => m.name.toLowerCase() !== entry.name.toLowerCase()
  );
  updated.push(entry);
  return { ...registry, marketplaces: updated };
}

export function removeMarketplaceEntry(
  registry: MarketplacesRegistry,
  name: string
): MarketplacesRegistry {
  const updated = registry.marketplaces.filter(
    (m) => m.name.toLowerCase() !== name.toLowerCase()
  );
  return { ...registry, marketplaces: updated };
}

export function getInstalledPlugin(
  registry: InstalledPluginsRegistry,
  pluginId: string
): InstalledPluginEntry[] {
  return registry.plugins[pluginId] || [];
}

export function addInstalledPlugin(
  registry: InstalledPluginsRegistry,
  pluginId: string,
  entry: InstalledPluginEntry
): InstalledPluginsRegistry {
  const existing = registry.plugins[pluginId] || [];
  const filtered = existing.filter((e) => e.scope !== entry.scope);
  filtered.push(entry);
  return {
    ...registry,
    plugins: {
      ...registry.plugins,
      [pluginId]: filtered,
    },
  };
}

export function removeInstalledPlugin(
  registry: InstalledPluginsRegistry,
  pluginId: string,
  scope?: "user" | "project"
): InstalledPluginsRegistry {
  const existing = registry.plugins[pluginId] || [];
  const filtered = scope ? existing.filter((e) => e.scope !== scope) : [];

  const updatedPlugins = { ...registry.plugins };
  if (filtered.length > 0) {
    updatedPlugins[pluginId] = filtered;
  } else {
    delete updatedPlugins[pluginId];
  }

  return {
    ...registry,
    plugins: updatedPlugins,
  };
}
