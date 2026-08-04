// @bun
// src/plugin.ts
import path6 from "path";

// src/claude-adapter.ts
import fs from "fs/promises";
import path from "path";
async function adaptClaudePlugin(pluginDir, ctx) {
  const home = process.env.USERPROFILE || process.env.HOME || "C:\\Users\\aaron";
  const opencodeDir = path.join(home, ".config", "opencode");
  const targetSkillsDir = path.join(opencodeDir, "skills");
  let manifest = { name: path.basename(pluginDir) };
  const manifestCandidates = [
    path.join(pluginDir, ".claude-plugin", "plugin.json"),
    path.join(pluginDir, "plugin.json")
  ];
  for (const cand of manifestCandidates) {
    try {
      const raw = await fs.readFile(cand, "utf-8");
      manifest = { ...manifest, ...JSON.parse(raw) };
      break;
    } catch {}
  }
  let commandsCount = 0;
  let skillsCount = 0;
  let agentsCount = 0;
  let mcpServersCount = 0;
  const commandsDir = path.join(pluginDir, "commands");
  if (await pathExists(commandsDir)) {
    try {
      const files = await fs.readdir(commandsDir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          const cmdName = path.basename(file, ".md");
          const content = await fs.readFile(path.join(commandsDir, file), "utf-8");
          if (ctx?.command?.register) {
            ctx.command.register({
              name: cmdName,
              description: `[Claude Plugin: ${manifest.name}] ${cmdName}`,
              execute: async () => content
            });
          }
          commandsCount++;
        }
      }
    } catch {}
  }
  const skillsDir = path.join(pluginDir, "skills");
  if (await pathExists(skillsDir)) {
    try {
      await fs.mkdir(targetSkillsDir, { recursive: true });
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(skillsDir, entry.name);
        const destPath = path.join(targetSkillsDir, entry.name);
        if (entry.isDirectory()) {
          await copyRecursive(srcPath, destPath);
          skillsCount++;
        } else if (entry.name.endsWith(".md")) {
          const skillName = path.basename(entry.name, ".md");
          const skillFolder = path.join(targetSkillsDir, skillName);
          await fs.mkdir(skillFolder, { recursive: true });
          await fs.copyFile(srcPath, path.join(skillFolder, "SKILL.md"));
          skillsCount++;
        }
      }
    } catch {}
  }
  const agentsDir = path.join(pluginDir, "agents");
  if (await pathExists(agentsDir)) {
    try {
      const files = await fs.readdir(agentsDir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          agentsCount++;
        }
      }
    } catch {}
  }
  const mcpCandidates = [
    path.join(pluginDir, "mcp.json"),
    path.join(pluginDir, ".claude-plugin", "mcp.json")
  ];
  let mcpConfig = manifest.mcpServers || {};
  for (const mcpFile of mcpCandidates) {
    try {
      const raw = await fs.readFile(mcpFile, "utf-8");
      const parsed = JSON.parse(raw);
      mcpConfig = { ...mcpConfig, ...parsed.mcpServers || parsed };
    } catch {}
  }
  if (Object.keys(mcpConfig).length > 0) {
    mcpServersCount = Object.keys(mcpConfig).length;
    if (ctx?.config) {
      ctx.config.mcp = { ...ctx.config.mcp || {}, ...mcpConfig };
    }
  }
  return {
    pluginName: manifest.name,
    commandsCount,
    skillsCount,
    agentsCount,
    mcpServersCount
  };
}
async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
async function copyRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// src/manager.ts
import path5 from "path";

// src/fetcher.ts
import { execSync } from "child_process";
import fs2 from "fs/promises";
import path2 from "path";
function classifySource(source) {
  if (source.startsWith("./") || source.startsWith("../") || path2.isAbsolute(source)) {
    return { type: "local", uri: path2.resolve(source) };
  }
  if (source.startsWith("http://") || source.startsWith("https://") || source.endsWith(".git")) {
    return { type: "url", uri: source };
  }
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(source)) {
    return { type: "github", uri: `https://github.com/${source}.git` };
  }
  return { type: "git", uri: source };
}
async function fetchMarketplace(source, cacheDir) {
  const { type, uri } = classifySource(source);
  if (type === "local") {
    const catalogPath2 = await findCatalogInDir(uri);
    const raw2 = await fs2.readFile(catalogPath2, "utf-8");
    const catalog2 = parseMarketplaceCatalog(raw2);
    return {
      catalog: catalog2,
      sourceType: "local",
      sourceUri: uri,
      catalogPath: catalogPath2
    };
  }
  const targetDirName = uri.replace(/[^a-zA-Z0-9_-]/g, "_");
  const targetPath = path2.join(cacheDir, targetDirName);
  await fs2.mkdir(cacheDir, { recursive: true });
  try {
    if (await dirExists(targetPath)) {
      execSync(`git -C "${targetPath}" pull --quiet`, { stdio: "ignore" });
    } else {
      execSync(`git clone --depth 1 "${uri}" "${targetPath}" --quiet`, { stdio: "ignore" });
    }
  } catch (err) {
    throw new Error(`Failed to clone/pull marketplace repository "${uri}": ${err?.message || err}`);
  }
  const catalogPath = await findCatalogInDir(targetPath);
  const raw = await fs2.readFile(catalogPath, "utf-8");
  const catalog = parseMarketplaceCatalog(raw);
  return {
    catalog,
    sourceType: type,
    sourceUri: uri,
    catalogPath,
    clonePath: targetPath
  };
}
async function findCatalogInDir(dir) {
  const candidates = [
    path2.join(dir, ".omp-plugin", "marketplace.json"),
    path2.join(dir, ".claude-plugin", "marketplace.json"),
    path2.join(dir, "marketplace.json")
  ];
  for (const candidate of candidates) {
    try {
      await fs2.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`No marketplace.json found in "${dir}". Expected .omp-plugin/marketplace.json or .claude-plugin/marketplace.json`);
}
function parseMarketplaceCatalog(rawJson) {
  const json = JSON.parse(rawJson);
  if (!json || typeof json.name !== "string" || !Array.isArray(json.plugins)) {
    throw new Error("Invalid marketplace.json manifest structure. Required fields: name, plugins[]");
  }
  return json;
}
async function dirExists(p) {
  try {
    const stat = await fs2.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// src/registry.ts
import fs3 from "fs/promises";
import path3 from "path";
async function readMarketplacesRegistry(registryPath) {
  try {
    const raw = await fs3.readFile(registryPath, "utf-8");
    const json = JSON.parse(raw);
    if (json && json.version === 1 && Array.isArray(json.marketplaces)) {
      return json;
    }
  } catch {}
  return { version: 1, marketplaces: [] };
}
async function writeMarketplacesRegistry(registryPath, registry) {
  await fs3.mkdir(path3.dirname(registryPath), { recursive: true });
  await fs3.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}
async function readInstalledPluginsRegistry(registryPath) {
  try {
    const raw = await fs3.readFile(registryPath, "utf-8");
    const json = JSON.parse(raw);
    if (json && (json.version === 2 || json.version === 1) && json.plugins) {
      return { version: 2, plugins: json.plugins };
    }
  } catch {}
  return { version: 2, plugins: {} };
}
async function writeInstalledPluginsRegistry(registryPath, registry) {
  await fs3.mkdir(path3.dirname(registryPath), { recursive: true });
  await fs3.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}
function getMarketplaceEntry(registry, name) {
  return registry.marketplaces.find((m) => m.name.toLowerCase() === name.toLowerCase());
}
function addMarketplaceEntry(registry, entry) {
  const updated = registry.marketplaces.filter((m) => m.name.toLowerCase() !== entry.name.toLowerCase());
  updated.push(entry);
  return { ...registry, marketplaces: updated };
}
function removeMarketplaceEntry(registry, name) {
  const updated = registry.marketplaces.filter((m) => m.name.toLowerCase() !== name.toLowerCase());
  return { ...registry, marketplaces: updated };
}
function addInstalledPlugin(registry, pluginId, entry) {
  const existing = registry.plugins[pluginId] || [];
  const filtered = existing.filter((e) => e.scope !== entry.scope);
  filtered.push(entry);
  return {
    ...registry,
    plugins: {
      ...registry.plugins,
      [pluginId]: filtered
    }
  };
}
function removeInstalledPlugin(registry, pluginId, scope) {
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
    plugins: updatedPlugins
  };
}

// src/source-resolver.ts
import path4 from "path";
async function resolvePluginSource(source, options) {
  if (typeof source === "string") {
    if (source.startsWith("./") || source.startsWith("../")) {
      return path4.resolve(options.marketplaceRoot, source);
    }
    return source;
  }
  switch (source.source) {
    case "npm": {
      const ver = source.version ? `@${source.version}` : "";
      return `${source.package}${ver}`;
    }
    case "github": {
      const ref = source.sha || source.ref || "main";
      return `github:${source.repo}#${ref}`;
    }
    case "git-subdir": {
      const ref = source.sha || source.ref || "main";
      return `git+${source.url}#${ref}:${source.path}`;
    }
    case "url": {
      const ref = source.sha || source.ref || "main";
      return `git+${source.url}#${ref}`;
    }
    default:
      throw new Error("Unsupported plugin source type");
  }
}

// src/types.ts
var NAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
var MAX_NAME_LENGTH = 64;
var MAX_ID_LENGTH = 128;
function isValidNameSegment(s) {
  return s.length > 0 && s.length <= MAX_NAME_LENGTH && NAME_RE.test(s);
}
function buildPluginId(name, marketplace) {
  if (!isValidNameSegment(name)) {
    throw new Error(`Invalid plugin name: "${name}"`);
  }
  if (!isValidNameSegment(marketplace)) {
    throw new Error(`Invalid marketplace name: "${marketplace}"`);
  }
  const id = `${name}@${marketplace}`;
  if (id.length > MAX_ID_LENGTH) {
    throw new Error(`Plugin ID exceeds ${MAX_ID_LENGTH} characters: "${id}"`);
  }
  return id;
}
function parsePluginId(id) {
  const atIndex = id.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === id.length - 1)
    return null;
  const name = id.slice(0, atIndex);
  const marketplace = id.slice(atIndex + 1);
  if (!isValidNameSegment(name) || !isValidNameSegment(marketplace))
    return null;
  return { name, marketplace };
}

// src/manager.ts
class MarketplaceManager {
  #opts;
  constructor(options) {
    this.#opts = options;
  }
  async addMarketplace(source) {
    const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
    const { catalog, sourceType, sourceUri, catalogPath } = await fetchMarketplace(source, this.#opts.marketplacesCacheDir);
    const now = new Date().toISOString();
    const entry = {
      name: catalog.name,
      sourceType,
      sourceUri,
      catalogPath,
      addedAt: now,
      updatedAt: now
    };
    const updatedReg = addMarketplaceEntry(reg, entry);
    await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updatedReg);
    return entry;
  }
  async removeMarketplace(name) {
    const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
    const updatedReg = removeMarketplaceEntry(reg, name);
    await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updatedReg);
  }
  async listMarketplaces() {
    const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
    return reg.marketplaces;
  }
  async fetchCatalog(name) {
    const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
    const entry = getMarketplaceEntry(reg, name);
    if (!entry) {
      throw new Error(`Marketplace "${name}" is not registered. Run /marketplace add <source> first.`);
    }
    const { catalog } = await fetchMarketplace(entry.sourceUri, this.#opts.marketplacesCacheDir);
    return catalog;
  }
  async installPlugin(pluginName, marketplaceName, options = {}) {
    const catalog = await this.fetchCatalog(marketplaceName);
    const pluginEntry = catalog.plugins.find((p) => p.name.toLowerCase() === pluginName.toLowerCase());
    if (!pluginEntry) {
      throw new Error(`Plugin "${pluginName}" not found in marketplace "${marketplaceName}".`);
    }
    const pluginId = buildPluginId(pluginEntry.name, catalog.name);
    const marketplaceRoot = path5.dirname(this.#opts.marketplacesCacheDir);
    const resolvedPath = await resolvePluginSource(pluginEntry.source, {
      marketplaceRoot,
      cacheDir: this.#opts.pluginsCacheDir
    });
    const scope = options.scope || "user";
    const registryPath = scope === "project" && this.#opts.projectInstalledRegistryPath ? this.#opts.projectInstalledRegistryPath : this.#opts.installedRegistryPath;
    const registry = await readInstalledPluginsRegistry(registryPath);
    const now = new Date().toISOString();
    const updatedRegistry = addInstalledPlugin(registry, pluginId, {
      scope,
      installPath: resolvedPath,
      version: pluginEntry.version || "1.0.0",
      installedAt: now,
      lastUpdated: now,
      enabled: true
    });
    await writeInstalledPluginsRegistry(registryPath, updatedRegistry);
    return pluginId;
  }
  async uninstallPlugin(pluginId, options = {}) {
    const scope = options.scope || "user";
    const registryPath = scope === "project" && this.#opts.projectInstalledRegistryPath ? this.#opts.projectInstalledRegistryPath : this.#opts.installedRegistryPath;
    const registry = await readInstalledPluginsRegistry(registryPath);
    const updatedRegistry = removeInstalledPlugin(registry, pluginId, scope);
    await writeInstalledPluginsRegistry(registryPath, updatedRegistry);
  }
  async listInstalledPlugins() {
    const userReg = await readInstalledPluginsRegistry(this.#opts.installedRegistryPath);
    const projectReg = this.#opts.projectInstalledRegistryPath ? await readInstalledPluginsRegistry(this.#opts.projectInstalledRegistryPath) : { version: 2, plugins: {} };
    const summaries = [];
    for (const [id, entries] of Object.entries(projectReg.plugins)) {
      summaries.push({ id, scope: "project", entries });
    }
    for (const [id, entries] of Object.entries(userReg.plugins)) {
      const existsInProject = Boolean(projectReg.plugins[id]);
      summaries.push({
        id,
        scope: "user",
        entries,
        shadowedBy: existsInProject ? "project" : undefined
      });
    }
    return summaries;
  }
}

// src/plugin.ts
function getPaths() {
  const home = process.env.USERPROFILE || process.env.HOME || "C:\\Users\\aaron";
  const configDir = path6.join(home, ".config", "opencode");
  return {
    marketplacesRegistryPath: path6.join(configDir, "marketplaces.json"),
    installedRegistryPath: path6.join(configDir, "installed_plugins.json"),
    marketplacesCacheDir: path6.join(configDir, "cache", "marketplaces"),
    pluginsCacheDir: path6.join(configDir, "cache", "plugins")
  };
}
async function plugin_default(ctx) {
  const paths = getPaths();
  const manager = new MarketplaceManager({
    marketplacesRegistryPath: paths.marketplacesRegistryPath,
    installedRegistryPath: paths.installedRegistryPath,
    projectInstalledRegistryPath: ctx?.cwd ? path6.join(ctx.cwd, ".opencode", "plugins", "installed_plugins.json") : undefined,
    marketplacesCacheDir: paths.marketplacesCacheDir,
    pluginsCacheDir: paths.pluginsCacheDir
  });
  try {
    const installed = await manager.listInstalledPlugins();
    for (const pluginSummary of installed) {
      const installPath = pluginSummary.entries[0]?.installPath;
      if (installPath) {
        await adaptClaudePlugin(installPath, ctx).catch(() => {});
      }
    }
  } catch {}
  const runInteractiveBrowser = async () => {
    const ui = ctx.tui || ctx.ui;
    if (ui?.select) {
      const choice = await ui.select({
        title: "\uD83D\uDED2 OpenCode Marketplace System (Claude Code / OMP Compatible)",
        options: [
          { label: "\uD83D\uDD0D Discover & Browse Plugins", value: "discover" },
          { label: "\u2795 Add Marketplace Source (Git / GitHub / Local)", value: "add" },
          { label: "\uD83D\uDCE6 Install Plugin (name@marketplace)", value: "install" },
          { label: "\uD83D\uDCCB List Configured Marketplaces", value: "list" },
          { label: "\u2705 List Installed Plugins", value: "installed" },
          { label: "\uD83D\uDDD1\uFE0F Uninstall Plugin", value: "uninstall" }
        ]
      });
      switch (choice) {
        case "add": {
          const source = await ui.input?.({
            title: "Add Marketplace",
            placeholder: "e.g. anthropics/claude-plugins-official or https://github.com/org/market"
          });
          if (!source)
            return "Cancelled.";
          const entry = await manager.addMarketplace(source);
          return `Added marketplace: **${entry.name}** (${entry.sourceUri})`;
        }
        case "list": {
          const list2 = await manager.listMarketplaces();
          if (list2.length === 0) {
            return "No marketplaces configured. Get started by running:\n  `/marketplace add anthropics/claude-plugins-official`";
          }
          return `**Configured Marketplaces:**
` + list2.map((m) => `\u2022 **${m.name}** \u2014 \`${m.sourceUri}\``).join(`
`);
        }
        case "discover": {
          const list2 = await manager.listMarketplaces();
          if (list2.length === 0) {
            return "No marketplaces configured. Add one first using `/marketplace add <source>`.";
          }
          let catalogName = list2[0].name;
          if (list2.length > 1) {
            catalogName = await ui.select({
              title: "Select Marketplace to Discover",
              options: list2.map((m) => ({ label: m.name, value: m.name }))
            });
          }
          const catalog = await manager.fetchCatalog(catalogName);
          const pluginOptions = catalog.plugins.map((p) => ({
            label: `${p.name} \u2014 ${p.description || "No description"} (v${p.version || "1.0"})`,
            value: `${p.name}@${catalog.name}`
          }));
          if (pluginOptions.length === 0)
            return `No plugins found in marketplace "${catalog.name}".`;
          const selectedId = await ui.select({
            title: `Plugins in ${catalog.name}`,
            options: pluginOptions
          });
          if (selectedId) {
            const { name, marketplace } = parsePluginId(selectedId);
            const res = await manager.installPlugin(name, marketplace);
            return `Successfully installed plugin **${res}**!`;
          }
          return "Selection cancelled.";
        }
        case "install": {
          const spec = await ui.input?.({
            title: "Install Plugin",
            placeholder: "Enter plugin specifier (e.g. wordpress.com@claude-plugins-official)..."
          });
          if (!spec)
            return "Cancelled.";
          const parsed = parsePluginId(spec);
          if (!parsed)
            return `Invalid plugin specifier format. Must be "name@marketplace" (e.g. "code-review@official").`;
          const res = await manager.installPlugin(parsed.name, parsed.marketplace);
          return `Successfully installed **${res}**!`;
        }
        case "installed": {
          const plugins = await manager.listInstalledPlugins();
          if (plugins.length === 0)
            return "No marketplace plugins currently installed.";
          return `**Installed Marketplace Plugins:**
` + plugins.map((p) => `\u2022 **${p.id}** [Scope: ${p.scope}] (${p.entries[0]?.installPath || ""})`).join(`
`);
        }
        case "uninstall": {
          const plugins = await manager.listInstalledPlugins();
          if (plugins.length === 0)
            return "No marketplace plugins installed to uninstall.";
          const pluginId = await ui.select({
            title: "Select Plugin to Uninstall",
            options: plugins.map((p) => ({ label: p.id, value: p.id }))
          });
          if (pluginId) {
            await manager.uninstallPlugin(pluginId);
            return `Successfully uninstalled plugin **${pluginId}**.`;
          }
          return "Cancelled.";
        }
      }
    }
    const list = await manager.listMarketplaces();
    return `**Marketplace Commands:**
` + `\u2022 \`/marketplace add <source>\` \u2014 Add marketplace (e.g. anthropics/claude-plugins-official)
` + `\u2022 \`/marketplace discover [marketplace]\` \u2014 Browse available plugins
` + `\u2022 \`/marketplace install <name@marketplace>\` \u2014 Install a plugin
` + `\u2022 \`/marketplace uninstall <name@marketplace>\` \u2014 Uninstall a plugin
` + `\u2022 \`/marketplace list\` \u2014 List configured marketplaces
` + `\u2022 \`/marketplace installed\` \u2014 List installed plugins

` + `Configured marketplaces: ${list.length}`;
  };
  const marketplaceHandler = async (argsInput) => {
    const rawArgs = Array.isArray(argsInput) ? argsInput : typeof argsInput === "string" ? argsInput.trim().split(/\s+/).filter(Boolean) : [];
    if (rawArgs.length === 0) {
      return await runInteractiveBrowser();
    }
    const verb = rawArgs[0].toLowerCase();
    const rest = rawArgs.slice(1).join(" ");
    switch (verb) {
      case "add": {
        if (!rest)
          return "Usage: `/marketplace add <source>` (e.g. `anthropics/claude-plugins-official`)";
        const entry = await manager.addMarketplace(rest);
        return `Added marketplace: **${entry.name}** (${entry.sourceUri})`;
      }
      case "remove": {
        if (!rest)
          return "Usage: `/marketplace remove <name>`";
        await manager.removeMarketplace(rest);
        return `Removed marketplace **${rest}**.`;
      }
      case "list": {
        const list = await manager.listMarketplaces();
        if (list.length === 0) {
          return "No marketplaces configured. Try:\n  `/marketplace add anthropics/claude-plugins-official`";
        }
        return `**Configured Marketplaces:**
` + list.map((m) => `\u2022 **${m.name}**  ${m.sourceUri}`).join(`
`);
      }
      case "discover": {
        const list = await manager.listMarketplaces();
        if (list.length === 0) {
          return "No marketplaces configured. Try:\n  `/marketplace add anthropics/claude-plugins-official`";
        }
        const targetCatalog = rest || list[0].name;
        const catalog = await manager.fetchCatalog(targetCatalog);
        return `**Plugins in ${catalog.name}:**
` + catalog.plugins.map((p) => `\u2022 **${p.name}@${catalog.name}** (${p.version || "1.0"}): ${p.description || "No description"}`).join(`
`);
      }
      case "install": {
        if (!rest)
          return "Usage: `/marketplace install <name@marketplace>`";
        const parsed = parsePluginId(rest);
        if (!parsed)
          return "Invalid format. Expected `name@marketplace` (e.g. `wordpress.com@claude-plugins-official`).";
        const res = await manager.installPlugin(parsed.name, parsed.marketplace);
        return `Installed plugin **${res}**!`;
      }
      case "uninstall": {
        if (!rest)
          return "Usage: `/marketplace uninstall <name@marketplace>`";
        await manager.uninstallPlugin(rest);
        return `Uninstalled plugin **${rest}**.`;
      }
      case "installed": {
        const plugins = await manager.listInstalledPlugins();
        if (plugins.length === 0)
          return "No marketplace plugins installed.";
        return `**Installed Marketplace Plugins:**
` + plugins.map((p) => `\u2022 **${p.id}** (${p.scope})`).join(`
`);
      }
      case "help":
      default:
        return await runInteractiveBrowser();
    }
  };
  const pluginsHandler = async (argsInput) => {
    const plugins = await manager.listInstalledPlugins();
    if (plugins.length === 0)
      return "No marketplace plugins currently installed.";
    return `**Installed Plugins:**
` + plugins.map((p) => `\u2022 **${p.id}** [${p.scope}] -> \`${p.entries[0]?.installPath || ""}\``).join(`
`);
  };
  if (ctx?.command?.register) {
    ctx.command.register({
      name: "marketplace",
      description: "Open Interactive Marketplace System (Claude Code / OMP Compatible)",
      execute: marketplaceHandler
    });
    ctx.command.register({
      name: "plugins",
      description: "List and manage installed plugins",
      execute: pluginsHandler
    });
  }
  return {
    commands: {
      marketplace: {
        description: "Open Interactive Marketplace System",
        handler: marketplaceHandler
      },
      plugins: {
        description: "List and manage installed plugins",
        handler: pluginsHandler
      }
    }
  };
}
export {
  plugin_default as default
};
