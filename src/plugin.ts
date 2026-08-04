import path from "node:path";
import { MarketplaceManager } from "./manager";
import { parsePluginId } from "./types";

function getPaths() {
  const home = process.env.USERPROFILE || process.env.HOME || "C:\\Users\\aaron";
  const configDir = path.join(home, ".config", "opencode");
  return {
    marketplacesRegistryPath: path.join(configDir, "marketplaces.json"),
    installedRegistryPath: path.join(configDir, "installed_plugins.json"),
    marketplacesCacheDir: path.join(configDir, "cache", "marketplaces"),
    pluginsCacheDir: path.join(configDir, "cache", "plugins"),
  };
}

export default async function (ctx: any) {
  const paths = getPaths();
  const manager = new MarketplaceManager({
    marketplacesRegistryPath: paths.marketplacesRegistryPath,
    installedRegistryPath: paths.installedRegistryPath,
    projectInstalledRegistryPath: ctx?.cwd
      ? path.join(ctx.cwd, ".opencode", "plugins", "installed_plugins.json")
      : undefined,
    marketplacesCacheDir: paths.marketplacesCacheDir,
    pluginsCacheDir: paths.pluginsCacheDir,
  });

  const runInteractiveBrowser = async () => {
    const ui = ctx.tui || ctx.ui;
    if (ui?.select) {
      const choice = await ui.select({
        title: "🛒 OpenCode Marketplace System (Claude Code / OMP Compatible)",
        options: [
          { label: "🔍 Discover & Browse Plugins", value: "discover" },
          { label: "➕ Add Marketplace Source (Git / GitHub / Local)", value: "add" },
          { label: "📦 Install Plugin (name@marketplace)", value: "install" },
          { label: "📋 List Configured Marketplaces", value: "list" },
          { label: "✅ List Installed Plugins", value: "installed" },
          { label: "🗑️ Uninstall Plugin", value: "uninstall" },
        ],
      });

      switch (choice) {
        case "add": {
          const source = await ui.input?.({
            title: "Add Marketplace",
            placeholder: "e.g. anthropics/claude-plugins-official or https://github.com/org/market",
          });
          if (!source) return "Cancelled.";
          const entry = await manager.addMarketplace(source);
          return `Added marketplace: **${entry.name}** (${entry.sourceUri})`;
        }
        case "list": {
          const list = await manager.listMarketplaces();
          if (list.length === 0) {
            return "No marketplaces configured. Get started by running:\n  `/marketplace add anthropics/claude-plugins-official`";
          }
          return `**Configured Marketplaces:**\n` + list.map((m) => `• **${m.name}** — \`${m.sourceUri}\``).join("\n");
        }
        case "discover": {
          const list = await manager.listMarketplaces();
          if (list.length === 0) {
            return "No marketplaces configured. Add one first using `/marketplace add <source>`.";
          }

          let catalogName = list[0].name;
          if (list.length > 1) {
            catalogName = await ui.select({
              title: "Select Marketplace to Discover",
              options: list.map((m) => ({ label: m.name, value: m.name })),
            });
          }

          const catalog = await manager.fetchCatalog(catalogName);
          const pluginOptions = catalog.plugins.map((p) => ({
            label: `${p.name} — ${p.description || "No description"} (v${p.version || "1.0"})`,
            value: `${p.name}@${catalog.name}`,
          }));

          if (pluginOptions.length === 0) return `No plugins found in marketplace "${catalog.name}".`;

          const selectedId = await ui.select({
            title: `Plugins in ${catalog.name}`,
            options: pluginOptions,
          });

          if (selectedId) {
            const { name, marketplace } = parsePluginId(selectedId)!;
            const res = await manager.installPlugin(name, marketplace);
            return `Successfully installed plugin **${res}**!`;
          }
          return "Selection cancelled.";
        }
        case "install": {
          const spec = await ui.input?.({
            title: "Install Plugin",
            placeholder: "Enter plugin specifier (e.g. wordpress.com@claude-plugins-official)...",
          });
          if (!spec) return "Cancelled.";
          const parsed = parsePluginId(spec);
          if (!parsed) return `Invalid plugin specifier format. Must be "name@marketplace" (e.g. "code-review@official").`;
          const res = await manager.installPlugin(parsed.name, parsed.marketplace);
          return `Successfully installed **${res}**!`;
        }
        case "installed": {
          const plugins = await manager.listInstalledPlugins();
          if (plugins.length === 0) return "No marketplace plugins currently installed.";
          return (
            `**Installed Marketplace Plugins:**\n` +
            plugins.map((p) => `• **${p.id}** [Scope: ${p.scope}] (${p.entries[0]?.installPath || ""})`).join("\n")
          );
        }
        case "uninstall": {
          const plugins = await manager.listInstalledPlugins();
          if (plugins.length === 0) return "No marketplace plugins installed to uninstall.";
          const pluginId = await ui.select({
            title: "Select Plugin to Uninstall",
            options: plugins.map((p) => ({ label: p.id, value: p.id })),
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
    return (
      `**Marketplace Commands:**\n` +
      `• \`/marketplace add <source>\` — Add marketplace (e.g. anthropics/claude-plugins-official)\n` +
      `• \`/marketplace discover [marketplace]\` — Browse available plugins\n` +
      `• \`/marketplace install <name@marketplace>\` — Install a plugin\n` +
      `• \`/marketplace uninstall <name@marketplace>\` — Uninstall a plugin\n` +
      `• \`/marketplace list\` — List configured marketplaces\n` +
      `• \`/marketplace installed\` — List installed plugins\n\n` +
      `Configured marketplaces: ${list.length}`
    );
  };

  const marketplaceHandler = async (argsInput: any) => {
    const rawArgs = Array.isArray(argsInput)
      ? argsInput
      : typeof argsInput === "string"
      ? argsInput.trim().split(/\s+/).filter(Boolean)
      : [];

    if (rawArgs.length === 0) {
      return await runInteractiveBrowser();
    }

    const verb = rawArgs[0].toLowerCase();
    const rest = rawArgs.slice(1).join(" ");

    switch (verb) {
      case "add": {
        if (!rest) return "Usage: `/marketplace add <source>` (e.g. `anthropics/claude-plugins-official`)";
        const entry = await manager.addMarketplace(rest);
        return `Added marketplace: **${entry.name}** (${entry.sourceUri})`;
      }
      case "remove": {
        if (!rest) return "Usage: `/marketplace remove <name>`";
        await manager.removeMarketplace(rest);
        return `Removed marketplace **${rest}**.`;
      }
      case "list": {
        const list = await manager.listMarketplaces();
        if (list.length === 0) {
          return "No marketplaces configured. Try:\n  `/marketplace add anthropics/claude-plugins-official`";
        }
        return `**Configured Marketplaces:**\n` + list.map((m) => `• **${m.name}**  ${m.sourceUri}`).join("\n");
      }
      case "discover": {
        const list = await manager.listMarketplaces();
        if (list.length === 0) {
          return "No marketplaces configured. Try:\n  `/marketplace add anthropics/claude-plugins-official`";
        }
        const targetCatalog = rest || list[0].name;
        const catalog = await manager.fetchCatalog(targetCatalog);
        return (
          `**Plugins in ${catalog.name}:**\n` +
          catalog.plugins
            .map((p) => `• **${p.name}@${catalog.name}** (${p.version || "1.0"}): ${p.description || "No description"}`)
            .join("\n")
        );
      }
      case "install": {
        if (!rest) return "Usage: `/marketplace install <name@marketplace>`";
        const parsed = parsePluginId(rest);
        if (!parsed) return "Invalid format. Expected `name@marketplace` (e.g. `wordpress.com@claude-plugins-official`).";
        const res = await manager.installPlugin(parsed.name, parsed.marketplace);
        return `Installed plugin **${res}**!`;
      }
      case "uninstall": {
        if (!rest) return "Usage: `/marketplace uninstall <name@marketplace>`";
        await manager.uninstallPlugin(rest);
        return `Uninstalled plugin **${rest}**.`;
      }
      case "installed": {
        const plugins = await manager.listInstalledPlugins();
        if (plugins.length === 0) return "No marketplace plugins installed.";
        return (
          `**Installed Marketplace Plugins:**\n` +
          plugins.map((p) => `• **${p.id}** (${p.scope})`).join("\n")
        );
      }
      case "help":
      default:
        return await runInteractiveBrowser();
    }
  };

  const pluginsHandler = async (argsInput: any) => {
    const plugins = await manager.listInstalledPlugins();
    if (plugins.length === 0) return "No marketplace plugins currently installed.";
    return (
      `**Installed Plugins:**\n` +
      plugins.map((p) => `• **${p.id}** [${p.scope}] -> \`${p.entries[0]?.installPath || ""}\``).join("\n")
    );
  };

  if (ctx?.command?.register) {
    ctx.command.register({
      name: "marketplace",
      description: "Open Interactive Marketplace System (Claude Code / OMP Compatible)",
      execute: marketplaceHandler,
    });
    ctx.command.register({
      name: "plugins",
      description: "List and manage installed plugins",
      execute: pluginsHandler,
    });
  }

  return {
    commands: {
      marketplace: {
        description: "Open Interactive Marketplace System",
        handler: marketplaceHandler,
      },
      plugins: {
        description: "List and manage installed plugins",
        handler: pluginsHandler,
      },
    },
  };
}
