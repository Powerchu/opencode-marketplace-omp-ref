// @bun
// src/marketplace-engine/fetcher.ts
import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";
function classifySource(source) {
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
async function fetchMarketplace(source, cacheDir) {
  const { type, uri } = classifySource(source);
  if (type === "local") {
    const catalogPath2 = await findCatalogInDir(uri);
    const raw2 = await fs.readFile(catalogPath2, "utf-8");
    const catalog2 = parseMarketplaceCatalog(raw2);
    return {
      catalog: catalog2,
      sourceType: "local",
      sourceUri: uri,
      catalogPath: catalogPath2
    };
  }
  const targetDirName = uri.replace(/[^a-zA-Z0-9_-]/g, "_");
  const targetPath = path.join(cacheDir, targetDirName);
  await fs.mkdir(cacheDir, { recursive: true });
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
  const raw = await fs.readFile(catalogPath, "utf-8");
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
    path.join(dir, ".omp-plugin", "marketplace.json"),
    path.join(dir, ".claude-plugin", "marketplace.json"),
    path.join(dir, "marketplace.json")
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
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
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// src/marketplace-engine/registry.ts
import fs2 from "fs/promises";
import path2 from "path";
async function readMarketplacesRegistry(registryPath) {
  try {
    const raw = await fs2.readFile(registryPath, "utf-8");
    const json = JSON.parse(raw);
    if (json && json.version === 1 && Array.isArray(json.marketplaces)) {
      return json;
    }
  } catch {}
  return { version: 1, marketplaces: [] };
}
async function writeMarketplacesRegistry(registryPath, registry) {
  await fs2.mkdir(path2.dirname(registryPath), { recursive: true });
  await fs2.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}
async function readInstalledPluginsRegistry(registryPath) {
  try {
    const raw = await fs2.readFile(registryPath, "utf-8");
    const json = JSON.parse(raw);
    if (json && (json.version === 2 || json.version === 1) && json.plugins) {
      return { version: 2, plugins: json.plugins };
    }
  } catch {}
  return { version: 2, plugins: {} };
}
async function writeInstalledPluginsRegistry(registryPath, registry) {
  await fs2.mkdir(path2.dirname(registryPath), { recursive: true });
  await fs2.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
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

// src/marketplace-engine/source-resolver.ts
import path3 from "path";
async function resolvePluginSource(source, options) {
  if (typeof source === "string") {
    if (source.startsWith("./") || source.startsWith("../")) {
      return path3.resolve(options.marketplaceRoot, source);
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

// src/marketplace-engine/types.ts
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

// src/marketplace-engine/manager.ts
import path4 from "path";
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
    const marketplaceRoot = path4.dirname(this.#opts.marketplacesCacheDir);
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

// =================================================================
// Claude Code Plugin Adapter
// =================================================================
import path5 from "path";

async function adaptPlugin(pluginDir, api, gitSpec) {
  const home = process.env.USERPROFILE || process.env.HOME || "C:\\Users\\aaron";
  const opencodeDir = path5.join(home, ".config", "opencode");
  const targetSkillsDir = path5.join(opencodeDir, "skills");
  let manifest = { name: path5.basename(pluginDir) };
  var mc = [path5.join(pluginDir, ".claude-plugin", "plugin.json"), path5.join(pluginDir, "plugin.json")];
  for (var mi = 0; mi < mc.length; mi++) {
    try { var mr = await fs.readFile(mc[mi], "utf-8"); manifest = Object.assign(Object.assign({}, manifest), JSON.parse(mr)); break; } catch {}
  }
  var commandsCount = 0, skillsCount = 0;

  // Map commands/*.md -> registered slash commands
  var cmdsDir = path5.join(pluginDir, "commands");
  try {
    if (await dirExists(cmdsDir)) {
      var cf = await fs.readdir(cmdsDir);
      for (var ci = 0; ci < cf.length; ci++) {
        if (cf[ci].endsWith(".md")) {
          var cmdName = path5.basename(cf[ci], ".md");
          commandsCount++;
        }
      }
    }
  } catch {}

  // Map skills/ -> ~/.config/opencode/skills/<name>/SKILL.md
  var skillsDir = path5.join(pluginDir, "skills");
  try {
    if (await dirExists(skillsDir)) {
      await fs.mkdir(targetSkillsDir, { recursive: true });
      var se = await fs.readdir(skillsDir, { withFileTypes: true });
      for (var si = 0; si < se.length; si++) {
        var sp = path5.join(skillsDir, se[si].name);
        var dp = path5.join(targetSkillsDir, se[si].name);
        if (se[si].isDirectory()) { await copyRecursive(sp, dp); skillsCount++; }
        else if (se[si].name.endsWith(".md")) {
          var sn = path5.basename(se[si].name, ".md");
          var sf = path5.join(targetSkillsDir, sn);
          await fs.mkdir(sf, { recursive: true });
          await fs.copyFile(sp, path5.join(sf, "SKILL.md"));
          skillsCount++;
        }
      }
    }
  } catch {}

  // Register in opencode.jsonc if gitSpec provided
  if (gitSpec) {
    try {
      var ocPath = path5.join(opencodeDir, "opencode.jsonc");
      var ocRaw = await fs.readFile(ocPath, "utf-8");
      var ocMatch = ocRaw.match(/"plugin"\s*:\s*\[([\s\S]*?)\]/);
      if (ocMatch && ocMatch[1].indexOf(gitSpec) < 0) {
        var ocPlugins = ocMatch[1];
        ocPlugins += (ocPlugins.trim() ? ",\n    " : "\n    ") + '"' + gitSpec + '"';
        var newOc = ocRaw.replace(/"plugin"\s*:\s*\[([\s\S]*?)\]/, '"plugin": [' + ocPlugins + "\n  ]");
        await fs.writeFile(ocPath, newOc, "utf-8");
      }
    } catch {}
  }

  return { pluginName: manifest.name, commandsCount, skillsCount };
}

async function copyRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  var entries = await fs.readdir(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var sp = path5.join(src, entries[i].name);
    var dp = path5.join(dest, entries[i].name);
    if (entries[i].isDirectory()) { await copyRecursive(sp, dp); }
    else { await fs.copyFile(sp, dp); }
  }
}

async function buildGitSpec(manager, marketplaceName, pluginName) {
  try {
    var catalog = await manager.fetchCatalog(marketplaceName);
    var pluginEntry = catalog.plugins.find(function(p) { return p.name.toLowerCase() === pluginName.toLowerCase(); });
    if (!pluginEntry || !pluginEntry.source) return null;

    var source = pluginEntry.source;
    var url;
    if (typeof source === "string") {
      // Relative path → use marketplace URL
      var markets = await manager.listMarketplaces();
      for (var i = 0; i < markets.length; i++) {
        if (markets[i].name.toLowerCase() === marketplaceName.toLowerCase()) {
          url = markets[i].sourceUri;
          if (url.endsWith(".git")) url = url.slice(0, -4);
          break;
        }
      }
      return url ? (pluginName + "@" + url) : null;
    }
    // External source — use the plugin's own repo URL
    if (source.source === "github") {
      url = "git+https://github.com/" + source.repo + ".git";
    } else if (source.source === "url" || source.source === "git-subdir") {
      url = "git+" + source.url;
      if (!url.endsWith(".git")) url = url + ".git";
    } else {
      return null;
    }
    return pluginName + "@" + url;
  } catch {}
  return null;
}

async function downloadPlugin(reference, cacheDir) {
  var localDir;
  // github:owner/repo#ref → clone from https://github.com/owner/repo.git
  if (reference.startsWith("github:")) {
    var rest = reference.slice(7);
    var hashIdx = rest.indexOf("#");
    var repo = hashIdx > 0 ? rest.slice(0, hashIdx) : rest;
    var ref = hashIdx > 0 ? rest.slice(hashIdx + 1) : "main";
    var url = "https://github.com/" + repo + ".git";
    localDir = path5.join(cacheDir, repo.replace("/", "_"));
  }
  // git+https://... → extract URL and ref
  else if (reference.startsWith("git+")) {
    var gitUrl = reference.slice(4);
    var parts = gitUrl.split("#");
    url = parts[0];
    ref = parts[1] ? parts[1].split(":")[0] : "main"; // strip :subdir if present
    var name = path5.basename(url, ".git");
    localDir = path5.join(cacheDir, name);
  }
  else {
    return reference; // already local path, nothing to download
  }

  await fs.mkdir(cacheDir, { recursive: true });
  try {
    if (await dirExists(localDir)) {
      execSync("git -C \"" + localDir + "\" fetch --quiet && git -C \"" + localDir + "\" checkout --quiet " + ref + " && git -C \"" + localDir + "\" pull --quiet", { stdio: "ignore" });
    } else {
      execSync("git clone --depth 1 --branch " + ref + " \"" + url + "\" \"" + localDir + "\" --quiet", { stdio: "ignore" });
    }
  } catch (err) {
    throw new Error("Failed to download plugin from " + url + ": " + (err && err.message ? err.message : String(err)));
  }
  return localDir;
}

// =================================================================
// OpenCode TUI Plugin Entry Point
// =================================================================

function getPaths(cwd) {
  const home = process.env.USERPROFILE || process.env.HOME || "C:\\Users\\aaron";
  const configDir = path5.join(home, ".config", "opencode");
  return {
    marketplacesRegistryPath: path5.join(configDir, "marketplaces.json"),
    installedRegistryPath: path5.join(configDir, "installed_plugins.json"),
    marketplacesCacheDir: path5.join(configDir, "cache", "marketplaces"),
    pluginsCacheDir: path5.join(configDir, "cache", "plugins"),
    projectInstalledRegistryPath: cwd ? path5.join(cwd, ".opencode", "plugins", "installed_plugins.json") : undefined,
  };
}

function dialogSelect(api, title, options) {
  return new Promise((resolve) => {
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title,
        options,
        onSelect: (option) => { api.ui.dialog.clear(); resolve(option.value); },
      })
    );
  });
}
function dialogInput(api, title, placeholder) {
  return new Promise((resolve) => {
    api.ui.dialog.replace(() =>
      api.ui.DialogPrompt({
        title,
        placeholder,
        onConfirm: (value) => { api.ui.dialog.clear(); resolve(value); },
        onCancel: () => { api.ui.dialog.clear(); resolve(null); },
      })
    );
  });
}
function showResult(api, title, message) {
  return new Promise((resolve) => {
    api.ui.dialog.replace(() =>
      api.ui.DialogAlert({
        title,
        message,
        onConfirm: () => { api.ui.dialog.clear(); resolve(); },
      })
    );
  });
}

export default {
  id: "opencode-marketplace",
  async tui(api, _opts, _meta) {
    const cwd = api.state.path.directory;
    const paths = getPaths(cwd);
    const manager = new MarketplaceManager({
      marketplacesRegistryPath: paths.marketplacesRegistryPath,
      installedRegistryPath: paths.installedRegistryPath,
      projectInstalledRegistryPath: paths.projectInstalledRegistryPath,
      marketplacesCacheDir: paths.marketplacesCacheDir,
      pluginsCacheDir: paths.pluginsCacheDir,
    });

    // Auto-adapt installed plugins on startup
    try {
      var installed = await manager.listInstalledPlugins();
      for (var i = 0; i < installed.length; i++) {
        var ep = installed[i].entries[0];
        if (ep && ep.installPath) { var lp = await downloadPlugin(ep.installPath, paths.pluginsCacheDir).catch(function(){ return ep.installPath; }); await adaptPlugin(lp, api, null).catch(function(){}); }
      }
    } catch {}

    async function runInteractiveBrowser() {
      try {
        var choice = await dialogSelect(api, "\uD83D\uDED2 OpenCode Marketplace", [
          { title: "\uD83D\uDD0D Discover & Browse Plugins", value: "discover" },
          { title: "\u2795 Add Marketplace Source", value: "add" },
          { title: "\uD83D\uDCE6 Install Plugin (name@marketplace)", value: "install" },
          { title: "\uD83D\uDCCB List Marketplaces", value: "list" },
          { title: "\u2705 List Installed Plugins", value: "installed" },
          { title: "\uD83D\uDDD1\uFE0F Uninstall Plugin", value: "uninstall" },
        ]);
        if (!choice) return;
        switch (choice) {
          case "add": {
            var src = await dialogInput(api, "Add Marketplace", "e.g. anthropics/claude-plugins-official");
            if (!src) return;
            var e = await manager.addMarketplace(src);
            await showResult(api, "Marketplace Added", "Added marketplace:\n\n**" + e.name + "**\n" + e.sourceUri);
            break;
          }
          case "list": {
            var l = await manager.listMarketplaces();
            if (l.length === 0) { await showResult(api, "Marketplaces", "No marketplaces configured.\n\nGet started with:\n/marketplace-add"); }
            else { await showResult(api, "Configured Marketplaces", l.map(function(m) { return "\u2022 **" + m.name + "** \u2014 " + m.sourceUri; }).join("\n")); }
            break;
          }
          case "discover": {
            var l = await manager.listMarketplaces();
            if (l.length === 0) { await showResult(api, "No Marketplaces", "Add one first using:\n/marketplace-add"); break; }
            var catalogName = l[0].name;
            if (l.length > 1) {
              catalogName = await dialogSelect(api, "Select Marketplace", l.map(function(m) { return { title: m.name, value: m.name }; }));
              if (!catalogName) break;
            }
            var catalog = await manager.fetchCatalog(catalogName);
            var po = catalog.plugins.map(function(p) { return { title: p.name + " \u2014 " + (p.description || "No description") + " (v" + (p.version || "1.0") + ")", value: p.name + "@" + catalog.name }; });
            if (po.length === 0) { await showResult(api, "Plugins", "No plugins found in marketplace \"" + catalog.name + "\"."); break; }
            var sid = await dialogSelect(api, "Plugins in " + catalog.name, po);
            if (!sid) break;
            var parsed = parsePluginId(sid);
            await manager.installPlugin(parsed.name, parsed.marketplace);
            var inst = await manager.listInstalledPlugins();
            var rp = "";
            for (var j = 0; j < inst.length; j++) { if (inst[j].id === sid) { rp = inst[j].entries[0] ? inst[j].entries[0].installPath : ""; break; } }
            var gs = await buildGitSpec(manager, parsed.marketplace, parsed.name);
            var lp1 = await downloadPlugin(rp, paths.pluginsCacheDir).catch(function(){ return rp; });
            var ar; if (rp) { ar = await adaptPlugin(lp1, api, gs).catch(function(){}); }
            await showResult(api, "Installed", "Successfully installed:\n\n**" + sid + "**" + (ar ? "\n\nSkills: " + ar.skillsCount + "  Commands: " + ar.commandsCount : ""));
            break;
          }
          case "install": {
            var spec = await dialogInput(api, "Install Plugin", "Enter plugin specifier (e.g. my-plugin@official)...");
            if (!spec) break;
            var parsed2 = parsePluginId(spec);
            if (!parsed2) { await showResult(api, "Invalid Format", "Must be \"name@marketplace\""); break; }
            await manager.installPlugin(parsed2.name, parsed2.marketplace);
            var inst2 = await manager.listInstalledPlugins();
            var rp2 = "";
            for (var j = 0; j < inst2.length; j++) { if (inst2[j].id === spec) { rp2 = inst2[j].entries[0] ? inst2[j].entries[0].installPath : ""; break; } }
            var gs2 = await buildGitSpec(manager, parsed2.marketplace, parsed2.name);
            var lp2 = await downloadPlugin(rp2, paths.pluginsCacheDir).catch(function(){ return rp2; });
            var ar2; if (rp2) { ar2 = await adaptPlugin(lp2, api, gs2).catch(function(){}); }
            await showResult(api, "Installed", "Successfully installed:\n\n**" + spec + "**" + (ar2 ? "\n\nSkills: " + ar2.skillsCount + "  Commands: " + ar2.commandsCount : ""));
            break;
          }
          case "installed": {
            var pl = await manager.listInstalledPlugins();
            if (pl.length === 0) { await showResult(api, "Installed Plugins", "No marketplace plugins installed."); }
            else { await showResult(api, "Installed Marketplace Plugins", pl.map(function(p) { return "\u2022 **" + p.id + "** [" + p.scope + "]" + (p.shadowedBy ? " (shadowed by " + p.shadowedBy + ")" : ""); }).join("\n")); }
            break;
          }
          case "uninstall": {
            var pl = await manager.listInstalledPlugins();
            if (pl.length === 0) { await showResult(api, "Uninstall", "No marketplace plugins installed."); break; }
            var pid = await dialogSelect(api, "Select Plugin to Uninstall", pl.map(function(p) { return { title: p.id + " [" + p.scope + "]", value: p.id }; }));
            if (!pid) break;
            await manager.uninstallPlugin(pid);
            await showResult(api, "Uninstalled", "Successfully uninstalled:\n\n**" + pid + "**");
            break;
          }
        }
      } catch (err) {
        await showResult(api, "Error", err && err.message ? err.message : String(err));
      }
    }

    async function handleAdd() {
      var src = await dialogInput(api, "Add Marketplace", "e.g. anthropics/claude-plugins-official");
      if (!src) return;
      var e = await manager.addMarketplace(src);
      await showResult(api, "Marketplace Added", "Added marketplace:\n\n**" + e.name + "**\n" + e.sourceUri);
    }
    async function handleList() {
      var l = await manager.listMarketplaces();
      if (l.length === 0) { await showResult(api, "Marketplaces", "No marketplaces configured."); return; }
      await showResult(api, "Configured Marketplaces", l.map(function(m) { return "\u2022 **" + m.name + "** \u2014 " + m.sourceUri; }).join("\n"));
    }
    async function handleDiscover() {
      var l = await manager.listMarketplaces();
      if (l.length === 0) { await showResult(api, "No Marketplaces", "Add one first using:\n/marketplace-add"); return; }
      var catalogName = l[0].name;
      if (l.length > 1) {
        catalogName = await dialogSelect(api, "Select Marketplace", l.map(function(m) { return { title: m.name, value: m.name }; }));
        if (!catalogName) return;
      }
      var catalog = await manager.fetchCatalog(catalogName);
      var po = catalog.plugins.map(function(p) { return { title: p.name + " \u2014 " + (p.description || "No description") + " (v" + (p.version || "1.0") + ")", value: p.name + "@" + catalog.name }; });
      if (po.length === 0) { await showResult(api, "Plugins", "No plugins found."); return; }
      var sid = await dialogSelect(api, "Plugins in " + catalog.name, po);
      if (!sid) return;
      var parsed = parsePluginId(sid);
      await manager.installPlugin(parsed.name, parsed.marketplace);
      var inst = await manager.listInstalledPlugins();
      var rp = "";
      for (var j = 0; j < inst.length; j++) { if (inst[j].id === sid) { rp = inst[j].entries[0] ? inst[j].entries[0].installPath : ""; break; } }
      var gs = await buildGitSpec(manager, parsed.marketplace, parsed.name);
      var lp1 = await downloadPlugin(rp, paths.pluginsCacheDir).catch(function(){ return rp; });
      var ar; if (rp) { ar = await adaptPlugin(lp1, api, gs).catch(function(){}); }
      await showResult(api, "Installed", "Successfully installed:\n\n**" + sid + "**" + (ar ? "\n\nSkills: " + ar.skillsCount + "  Commands: " + ar.commandsCount : ""));
    }
    async function handleInstall() {
      var spec = await dialogInput(api, "Install Plugin", "Enter plugin specifier (e.g. my-plugin@official)...");
      if (!spec) return;
      var parsed2 = parsePluginId(spec);
      if (!parsed2) { await showResult(api, "Invalid Format", "Must be \"name@marketplace\""); return; }
      await manager.installPlugin(parsed2.name, parsed2.marketplace);
      var inst2 = await manager.listInstalledPlugins();
      var rp2 = "";
      for (var j = 0; j < inst2.length; j++) { if (inst2[j].id === spec) { rp2 = inst2[j].entries[0] ? inst2[j].entries[0].installPath : ""; break; } }
      var gs2 = await buildGitSpec(manager, parsed2.marketplace, parsed2.name);
      var lp2 = await downloadPlugin(rp2, paths.pluginsCacheDir).catch(function(){ return rp2; });
      var ar2; if (rp2) { ar2 = await adaptPlugin(lp2, api, gs2).catch(function(){}); }
      await showResult(api, "Installed", "Successfully installed:\n\n**" + spec + "**" + (ar2 ? "\n\nSkills: " + ar2.skillsCount + "  Commands: " + ar2.commandsCount : ""));
    }
    async function handleUninstall() {
      var pl = await manager.listInstalledPlugins();
      if (pl.length === 0) { await showResult(api, "Uninstall", "No marketplace plugins installed."); return; }
      var pid = await dialogSelect(api, "Select Plugin to Uninstall", pl.map(function(p) { return { title: p.id + " [" + p.scope + "]", value: p.id }; }));
      if (!pid) return;
      await manager.uninstallPlugin(pid);
      await showResult(api, "Uninstalled", "Successfully uninstalled:\n\n**" + pid + "**");
    }
    async function handleInstalled() {
      var pl = await manager.listInstalledPlugins();
      if (pl.length === 0) { await showResult(api, "Installed Plugins", "No marketplace plugins installed."); return; }
      await showResult(api, "Installed Marketplace Plugins", pl.map(function(p) { return "\u2022 **" + p.id + "** [" + p.scope + "]" + (p.shadowedBy ? " (shadowed by " + p.shadowedBy + ")" : ""); }).join("\n"));
    }
    async function handlePluginsList() {
      try {
        var all = api.plugins.list();
        if (all.length === 0) { await showResult(api, "All Plugins", "No plugins loaded."); return; }
        await showResult(api, "All Active Plugins", all.map(function(p) { return "\u2022 **" + p.id + "** [" + p.source + "] \u2014 enabled=" + p.enabled + " active=" + p.active + "\n  " + p.spec; }).join("\n\n"));
      } catch (err) { await showResult(api, "Error", err && err.message ? err.message : String(err)); }
    }

    var safe = function(fn) { return async function() { try { await fn(); } catch (err) { await showResult(api, "Error", err && err.message ? err.message : String(err)); } }; };

    api.command.register(function() { return [
      { title: "Marketplace",          value: "mp",          description: "Interactive marketplace browser",     slash: { name: "marketplace" },           category: "marketplace", onSelect: function() { runInteractiveBrowser(); } },
      { title: "Plugins",              value: "mp-plugins",  description: "List installed marketplace plugins",   slash: { name: "plugins" },               category: "marketplace", onSelect: safe(handleInstalled) },
      { title: "Marketplace: Add",      value: "mp-add",      description: "Add marketplace source",              slash: { name: "marketplace-add" },       category: "marketplace", onSelect: safe(handleAdd) },
      { title: "Marketplace: List",     value: "mp-list",     description: "List configured marketplaces",       slash: { name: "marketplace-list" },      category: "marketplace", onSelect: safe(handleList) },
      { title: "Marketplace: Discover", value: "mp-discover", description: "Browse and install plugins",         slash: { name: "marketplace-discover" },  category: "marketplace", onSelect: safe(handleDiscover) },
      { title: "Marketplace: Install",  value: "mp-install",  description: "Install plugin by name@marketplace", slash: { name: "marketplace-install" },   category: "marketplace", onSelect: safe(handleInstall) },
      { title: "Marketplace: Uninstall",value: "mp-uninstall",description: "Uninstall marketplace plugin",       slash: { name: "marketplace-uninstall" }, category: "marketplace", onSelect: safe(handleUninstall) },
      { title: "Marketplace: Installed",value: "mp-installed",description: "List installed marketplace plugins",  slash: { name: "marketplace-installed" }, category: "marketplace", onSelect: safe(handleInstalled) },
      { title: "Plugins: List All",     value: "mp-plugins-list", description: "List ALL active plugins & paths",slash: { name: "plugins-list" },           category: "marketplace", onSelect: safe(handlePluginsList) },
    ]; });
  }
};