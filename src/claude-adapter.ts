import fs from "node:fs/promises";
import path from "node:path";

export interface ClaudePluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: { name: string; email?: string };
  homepage?: string;
  repository?: string;
  commands?: Record<string, string>;
  agents?: Record<string, string>;
  mcpServers?: Record<string, any>;
  lspServers?: Record<string, any>;
}

export interface AdaptResult {
  pluginName: string;
  commandsCount: number;
  skillsCount: number;
  agentsCount: number;
  mcpServersCount: number;
  lspServersCount: number;
}

export async function adaptClaudePlugin(pluginDir: string, ctx: any): Promise<AdaptResult> {
  const home = process.env.USERPROFILE || process.env.HOME || "C:\\Users\\aaron";
  const opencodeDir = path.join(home, ".config", "opencode");
  const targetSkillsDir = path.join(opencodeDir, "skills");

  let manifest: ClaudePluginManifest = { name: path.basename(pluginDir) };

  // 1. Read manifest (.claude-plugin/plugin.json or plugin.json)
  const manifestCandidates = [
    path.join(pluginDir, ".claude-plugin", "plugin.json"),
    path.join(pluginDir, "plugin.json"),
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
  let lspServersCount = 0;

  // 2. Map commands/*.md -> OpenCode Slash Commands
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
              execute: async () => content,
            });
          }
          commandsCount++;
        }
      }
    } catch {}
  }

  // 3. Map skills/ -> OpenCode Skills Directory (~/.config/opencode/skills/)
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

  // 4. Map agents/*.md -> OpenCode Agent instructions
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

  // 5. Map mcp.json or manifest.mcpServers -> OpenCode MCP config
  const mcpCandidates = [
    path.join(pluginDir, "mcp.json"),
    path.join(pluginDir, ".claude-plugin", "mcp.json"),
  ];

  let mcpConfig: Record<string, any> = manifest.mcpServers || {};

  for (const mcpFile of mcpCandidates) {
    try {
      const raw = await fs.readFile(mcpFile, "utf-8");
      const parsed = JSON.parse(raw);
      mcpConfig = { ...mcpConfig, ...(parsed.mcpServers || parsed) };
    } catch {}
  }

  if (Object.keys(mcpConfig).length > 0) {
    mcpServersCount = Object.keys(mcpConfig).length;
    if (ctx?.config) {
      ctx.config.mcp = { ...(ctx.config.mcp || {}), ...mcpConfig };
    }
  }

  // 6. Map lsp.json or manifest.lspServers -> OpenCode LSP config
  const lspCandidates = [
    path.join(pluginDir, "lsp.json"),
    path.join(pluginDir, ".claude-plugin", "lsp.json"),
  ];

  let lspConfig: Record<string, any> = manifest.lspServers || {};

  for (const lspFile of lspCandidates) {
    try {
      const raw = await fs.readFile(lspFile, "utf-8");
      const parsed = JSON.parse(raw);
      lspConfig = { ...lspConfig, ...(parsed.lspServers || parsed) };
    } catch {}
  }

  if (Object.keys(lspConfig).length > 0) {
    lspServersCount = Object.keys(lspConfig).length;
    if (ctx?.config) {
      ctx.config.lsp = {
        ...(typeof ctx.config.lsp === "object" ? ctx.config.lsp : {}),
        ...lspConfig,
      };
    }
  }

  return {
    pluginName: manifest.name,
    commandsCount,
    skillsCount,
    agentsCount,
    mcpServersCount,
    lspServersCount,
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyRecursive(src: string, dest: string): Promise<void> {
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
