// opencode-marketplace — TUI frontend over CKGrafico's marketplace mechanism
// Downloads Claude Code/Cursor plugin agents + skills to .opencode/ directory
// @bun
var path = require("path");
var fs = require("fs/promises");
var os = require("os");
var pfs = require("fs");
var child_process = require("child_process");

var MARKETPLACE_PATHS = [
  ".github/plugin/marketplace.json",
  ".claude-plugin/marketplace.json",
  "marketplace.json",
];

var REGISTRY_DIR = path.join(os.homedir(), ".opencode-market");
var REGISTRY_FILE = path.join(REGISTRY_DIR, "registries.json");

// ── GitHub API helpers ──────────────────────────────────────────────────────

function getToken() {
  return new Promise(function(resolve) {
    if (process.env.GITHUB_TOKEN) { resolve(process.env.GITHUB_TOKEN); return; }
    child_process.exec("gh auth token", { timeout: 5000 }, function(err, stdout) {
      resolve(err ? null : (stdout || "").trim() || null);
    });
  });
}

function fetchRawFile(owner, repo, ref, filePath) {
  return new Promise(async function(resolve) {
    var url = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + ref + "/" + filePath;
    var token = await getToken();
    var headers = {};
    if (token) headers["Authorization"] = "token " + token;
    try {
      var res = await fetch(url, { headers: headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) { resolve(null); return; }
      resolve(await res.text());
    } catch (e) { resolve(null); }
  });
}

function fetchJsonFile(owner, repo, ref, filePath) {
  return new Promise(async function(resolve) {
    var text = await fetchRawFile(owner, repo, ref, filePath);
    if (!text) { resolve(null); return; }
    try { resolve(JSON.parse(text)); } catch (e) { resolve(null); }
  });
}

function listGitHubDirectory(owner, repo, ref, dirPath) {
  return new Promise(async function(resolve) {
    var token = await getToken();
    var headers = { "Accept": "application/vnd.github+json" };
    if (token) headers["Authorization"] = "token " + token;
    var url = "https://api.github.com/repos/" + owner + "/" + repo + "/git/trees/" + ref + "?recursive=1";
    try {
      var res = await fetch(url, { headers: headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) { resolve([]); return; }
      var data = await res.json();
      var prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
      resolve((data.tree || []).filter(function(i) { return i.path.startsWith(prefix); }).map(function(i) { return { path: i.path, type: i.type }; }));
    } catch (e) { resolve([]); }
  });
}

// ── Registry helpers ────────────────────────────────────────────────────────

async function readRegistries() {
  try { if (!pfs.existsSync(REGISTRY_FILE)) return {}; return JSON.parse(await fs.readFile(REGISTRY_FILE, "utf-8")); } catch (e) { return {}; }
}

async function writeRegistries(data) {
  await fs.mkdir(REGISTRY_DIR, { recursive: true });
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function setMarketplace(name, entry) {
  var r = await readRegistries();
  r[name] = Object.assign(r[name] || {}, entry);
  await writeRegistries(r);
}

async function getMarketplace(name) {
  var r = await readRegistries();
  return r[name] || null;
}

async function markInstalled(marketplaceName, pluginName) {
  var r = await readRegistries();
  var e = r[marketplaceName];
  if (!e) return;
  if (!Array.isArray(e.installed)) e.installed = [];
  if (!e.installed.includes(pluginName)) e.installed.push(pluginName);
  await writeRegistries(r);
}

// ── Download helpers ────────────────────────────────────────────────────────

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function downloadFolder(owner, repo, ref, remotePath, localBase) {
  var normalized = remotePath.replace(/\/+$/, "");
  var items = await listGitHubDirectory(owner, repo, ref, normalized);
  var blobs = items.filter(function(i) { return i.type === "blob"; });

  // Try alternate path (dotfile vs normal)
  if (blobs.length === 0) {
    var lastSeg = normalized.split("/").pop();
    var alternate = normalized;
    if (lastSeg.startsWith(".")) {
      alternate = normalized.replace(new RegExp("\\." + escapeRegExp(lastSeg.slice(1)) + "$"), lastSeg.slice(1));
    } else {
      alternate = normalized.replace(new RegExp(escapeRegExp(lastSeg) + "$"), "." + lastSeg);
    }
    if (alternate !== normalized) {
      items = await listGitHubDirectory(owner, repo, ref, alternate);
      blobs = items.filter(function(i) { return i.type === "blob"; });
      normalized = alternate;
    }
  }

  if (blobs.length === 0) return 0;

  for (var i = 0; i < blobs.length; i++) {
    var relPath = blobs[i].path.slice(normalized.length + 1);
    var localPath = path.join(localBase, relPath);
    var content = await fetchRawFile(owner, repo, ref, blobs[i].path);
    if (!content) continue;
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, content, "utf-8");
  }
  return blobs.length;
}

async function installPluginFiles(owner, repo, ref, pluginBasePath, pluginJson, options) {
  options = options || {};
  var cwd = options.cwd || process.cwd();
  var base = options.opencode ? path.join(cwd, ".opencode") : path.join(cwd, ".agents");
  var prefix = (!pluginBasePath || pluginBasePath === ".") ? "" : pluginBasePath.replace(/\/+$/, "") + "/";

  var total = 0;
  if (pluginJson.agents) {
    var agentsPath = (prefix + pluginJson.agents).replace(/\/+/g, "/").replace(/\/\.\//g, "/").replace(/\/\.$/, "").replace(/^\//, "");
    total += await downloadFolder(owner, repo, ref, agentsPath, path.join(base, "agents"));
  }
  if (pluginJson.skills) {
    var skillsPath = (prefix + pluginJson.skills).replace(/\/+/g, "/").replace(/\/\.\//g, "/").replace(/\/\.$/, "").replace(/^\//, "");
    total += await downloadFolder(owner, repo, ref, skillsPath, path.join(base, "skills"));
  }
  return { base: base, files: total };
}

async function fetchPluginJson(owner, repo, ref, marketplaceSource, pluginSourceRelative) {
  var normalised = pluginSourceRelative.replace(/^\.\//, "").replace(/\/+$/, "") || ".";
  var rootDir = normalised === "." ? "" : normalised;
  var rootPath = rootDir ? rootDir + "/plugin.json" : "plugin.json";
  var result = await fetchJsonFile(owner, repo, ref, rootPath);
  if (result) return { pluginJson: result, pluginBasePath: rootDir };

  var marketplaceDir = path.posix.dirname(marketplaceSource);
  var relDir = path.posix.join(marketplaceDir, normalised).replace(/\/+$/, "");
  var relPath = relDir + "/plugin.json";
  result = await fetchJsonFile(owner, repo, ref, relPath);
  if (result) return { pluginJson: result, pluginBasePath: relDir };
  return null;
}

// ── Command handlers ────────────────────────────────────────────────────────

async function addMarketplace(ownerRepo) {
  var parts = ownerRepo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return "Invalid repo format: " + ownerRepo + ". Expected owner/repo";
  var owner = parts[0], repo = parts[1], ref = "main";

  var marketplace = null, sourcePath = null;
  for (var i = 0; i < MARKETPLACE_PATHS.length; i++) {
    var data = await fetchJsonFile(owner, repo, ref, MARKETPLACE_PATHS[i]);
    if (data && data.name) { marketplace = data; sourcePath = MARKETPLACE_PATHS[i]; break; }
  }
  if (!marketplace) return "Could not find marketplace.json in " + ownerRepo;

  await setMarketplace(marketplace.name, { repo: ownerRepo, ref: ref, source: sourcePath, installed: [] });
  var lines = ["Registered marketplace: **" + marketplace.name + "**"];
  if (marketplace.plugins && marketplace.plugins.length) {
    lines.push("", "Available plugins:");
    marketplace.plugins.forEach(function(p) { lines.push("- " + p.name + " v" + p.version + " — " + (p.description || "")); });
  }
  return lines.join("\n");
}

async function listAll() {
  var r = await readRegistries();
  var names = Object.keys(r);
  var lines = [];
  lines.push("### Registered Marketplaces");
  lines.push("");
  if (names.length === 0) {
    lines.push("(none)");
    lines.push("");
    lines.push("Add one with: `/marketplace-add` or `/marketplace add <owner/repo>`");
  } else {
    names.forEach(function(n) {
      var e = r[n];
      lines.push("- **" + n + "** → " + e.repo);
      if (e.installed && e.installed.length) {
        e.installed.forEach(function(p) { lines.push("  - " + p + " (installed)"); });
      }
    });
  }
  return lines.join("\n");
}

async function installPlugin(pluginAtMarketplace, options) {
  var atIdx = pluginAtMarketplace.indexOf("@");
  if (atIdx === -1) return "Invalid format: " + pluginAtMarketplace + ". Expected: plugin@marketplace";
  var pluginName = pluginAtMarketplace.slice(0, atIdx);
  var marketplaceName = pluginAtMarketplace.slice(atIdx + 1);

  var registry = await getMarketplace(marketplaceName);
  if (!registry) return "Marketplace \"" + marketplaceName + "\" not registered. `/marketplace-add` first.";

  var parts = registry.repo.split("/");
  var owner = parts[0], repo = parts[1];
  var marketplace = await fetchJsonFile(owner, repo, registry.ref, registry.source);
  if (!marketplace) return "Could not fetch marketplace.json";

  var pluginEntry = (marketplace.plugins || []).find(function(p) { return p.name === pluginName; });
  if (!pluginEntry) {
    var names = (marketplace.plugins || []).map(function(p) { return "  - " + p.name; }).join("\n");
    return "Plugin \"" + pluginName + "\" not found.\n\nAvailable:\n" + names;
  }

  var result = await fetchPluginJson(owner, repo, registry.ref, registry.source, pluginEntry.source);
  if (!result) return "Could not fetch plugin.json for \"" + pluginName + "\"";

  var installResult = await installPluginFiles(owner, repo, registry.ref, result.pluginBasePath, result.pluginJson, options);
  await markInstalled(marketplaceName, pluginName);

  return "Installed **" + pluginName + "** v" + result.pluginJson.version + " (" + installResult.files + " files) → " + installResult.base;
}

async function searchCatalog(query) {
  query = query || "";
  var regs = await readRegistries();
  var names = Object.keys(regs);
  if (names.length === 0) return "No marketplaces registered. Run `/marketplace-add` first.";

  var allPlugins = [];
  for (var i = 0; i < names.length; i++) {
    var e = regs[names[i]];
    var parts = e.repo.split("/");
    try {
      var mp = await fetchJsonFile(parts[0], parts[1], e.ref, e.source);
      if (mp && mp.plugins) {
        mp.plugins.forEach(function(p) {
          allPlugins.push({ name: p.name, description: p.description || "", version: p.version || "", marketplace: names[i] });
        });
      }
    } catch (ex) {}
  }

  if (query) {
    var q = query.toLowerCase();
    allPlugins = allPlugins.filter(function(p) {
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    });
  }

  if (allPlugins.length === 0) return query ? "No plugins matching \"" + query + "\"" : "No plugins found";

  var lines = [];
  lines.push(query ? "Search results for \"" + query + "\":" : "Available plugins:");
  lines.push("");
  allPlugins.forEach(function(p) {
    lines.push("- **" + p.name + "**@" + p.marketplace + " v" + p.version + " — " + p.description);
  });
  lines.push("");
  lines.push("Install with: `/marketplace-install`");
  return lines.join("\n");
}

// ── Plugin export ───────────────────────────────────────────────────────────

var plugin = {
  id: "opencode-marketplace",
  async tui(api, _opts, _meta) {
    api.command.register(function() { return [
      {
        title: "Marketplace Add",
        value: "marketplace-add",
        description: "Register a Claude Code marketplace from GitHub (owner/repo)",
        slash: { name: "marketplace-add" },
        async onSelect() {
          var result = await api.ui.DialogPrompt({
            title: "Add Marketplace",
            message: "Enter GitHub owner/repo:",
            placeholder: "anthropics/claude-plugins-official",
            onSubmit: async function(val) {
              var output = await addMarketplace(val.trim());
              api.ui.dialog.replace(function() { return api.ui.DialogAlert({ title: "Marketplace Added", message: output, onConfirm: function() { api.ui.dialog.clear(); } }); });
            }
          });
          api.ui.dialog.replace(function() { return result; });
        }
      },
      {
        title: "Marketplace Discover",
        value: "marketplace-discover",
        description: "Browse and search plugins from all registered marketplaces",
        slash: { name: "marketplace-discover" },
        async onSelect() {
          var result = await api.ui.DialogPrompt({
            title: "Search Plugins",
            message: "Enter search term (leave empty for all):",
            placeholder: "e.g. frontend, agent, deploy",
            onSubmit: async function(query) {
              var output = await searchCatalog(query);
              api.ui.dialog.replace(function() { return api.ui.DialogAlert({ title: "Plugin Results", message: output, onConfirm: function() { api.ui.dialog.clear(); } }); });
            }
          });
          api.ui.dialog.replace(function() { return result; });
        }
      },
      {
        title: "Marketplace Install",
        value: "marketplace-install",
        description: "Install a plugin (plugin@marketplace format)",
        slash: { name: "marketplace-install" },
        async onSelect() {
          var result = await api.ui.DialogPrompt({
            title: "Install Plugin",
            message: "Enter plugin@marketplace:",
            placeholder: "e.g. frontend-design@claude-plugins-official",
            onSubmit: async function(val) {
              var output = await installPlugin(val.trim());
              api.ui.dialog.replace(function() { return api.ui.DialogAlert({ title: "Install Result", message: output, onConfirm: function() { api.ui.dialog.clear(); } }); });
            }
          });
          api.ui.dialog.replace(function() { return result; });
        }
      },
      {
        title: "Marketplace List",
        value: "marketplace-list",
        description: "List all registered marketplaces and installed plugins",
        slash: { name: "marketplace-list" },
        async onSelect() {
          var output = await listAll();
          api.ui.dialog.replace(function() { return api.ui.DialogAlert({ title: "Marketplaces", message: output, onConfirm: function() { api.ui.dialog.clear(); } }); });
        }
      },
      {
        title: "Marketplace Search",
        value: "marketplace-search",
        description: "Quick search across all registered marketplaces",
        slash: { name: "marketplace-search" },
        async onSelect() {
          var result = await api.ui.DialogPrompt({
            title: "Quick Search",
            message: "Search for plugins:",
            placeholder: "e.g. review, deploy, lint",
            onSubmit: async function(query) {
              var output = await searchCatalog(query);
              api.ui.dialog.replace(function() { return api.ui.DialogAlert({ title: "Search Results", message: output, onConfirm: function() { api.ui.dialog.clear(); } }); });
            }
          });
          api.ui.dialog.replace(function() { return result; });
        }
      }
    ]; });
  }
};

export { plugin as default };
