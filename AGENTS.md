# AGENTS.md — Claude Code Plugin Adapter Architecture for OpenCode

This document explains the **Claude Code Plugin to OpenCode Adapter (`claude-adapter.ts`)** architecture implemented in `opencode-marketplace-omp-ref`.

---

## 🎯 Purpose & Overview

Claude Code plugins are declarative folder packages containing skills (`SKILL.md`), slash commands (`commands/*.md`), custom agent roles (`agents/*.md`), Language Server Protocol declarations (`lspServers` / `lsp.json`), and Model Context Protocol servers (`mcp.json`).

The **Claude Code Plugin Adapter** bridges these declarative artifacts dynamically into **OpenCode's runtime plugin context** at startup without requiring plugin authors to rewrite their code.

---

## 🔄 Automatic Mapping Architecture

```text
Claude Code Plugin Package               OpenCode Adapter Translation
──────────────────────────               ────────────────────────────
plugin-name/
├── .claude-plugin/plugin.json  ──► Manifest metadata & plugin identity
├── commands/
│   ├── review.md               ──► OpenCode Slash Command: /review
│   └── deploy.md               ──► OpenCode Slash Command: /deploy
├── skills/
│   └── database-audit/
│       └── SKILL.md            ──► ~/.config/opencode/skills/database-audit/SKILL.md
├── agents/
│   └── security-auditor.md     ──► OpenCode Subagent / Role Prompt Context
├── mcp.json                    ──► Injected into OpenCode "mcp" server registry
└── lsp.json (or lspServers)   ──► Injected into OpenCode "lsp" language server registry
```

---

## 🛠️ Translation Mechanisms

### 1. Slash Commands (`commands/*.md`)
- **Source**: Every `.md` file inside the plugin's `commands/` directory.
- **Translation**: The adapter registers an OpenCode command via `ctx.command.register({ name, description, execute })`.
- **Result**: Users can invoke `/command-name` directly in OpenCode's TUI.

### 2. Skills (`skills/*/SKILL.md`)
- **Source**: Directories inside `skills/` containing `SKILL.md` (or standalone `.md` files).
- **Translation**: The adapter recursively links/copies the skill folders into OpenCode's skill discovery root (`~/.config/opencode/skills/`).
- **Result**: OpenCode's autonomous agents (Sisyphus, Prometheus, etc.) automatically discover and invoke the skill when relevant, and users can trigger it via `/skill-name`.

### 3. Agent Roles (`agents/*.md`)
- **Source**: Role specification files in `agents/`.
- **Translation**: Injected into OpenCode's instruction system for subagent delegation (`invoke_subagent`).

### 4. MCP Servers (`mcp.json` / `mcpServers`)
- **Source**: `mcp.json` or `mcpServers` object in `plugin.json`.
- **Translation**: Dynamically merged into OpenCode's active MCP context (`ctx.config.mcp`).
- **Result**: External tools (databases, browsers, devtools) connect seamlessly as OpenCode tools.

### 5. LSP Servers (`lsp.json` / `lspServers`)
- **Source**: `lsp.json` or `lspServers` object in `plugin.json`.
- **Translation**: Converted and merged into OpenCode's Language Server Protocol context (`ctx.config.lsp`).
- **Result**: Code intelligence (autocompletion, go-to-definition, diagnostics for Go, TypeScript, Rust, Python, etc.) automatically initializes in OpenCode!

---

## 💻 Developer API Usage

```typescript
import { adaptClaudePlugin } from "./claude-adapter";

// Adapt any installed Claude Code plugin directory into OpenCode context
const result = await adaptClaudePlugin("/path/to/claude-plugin-dir", ctx);

console.log(`Adapted ${result.pluginName}:`);
console.log(`  Commands registered: ${result.commandsCount}`);
console.log(`  Skills imported:     ${result.skillsCount}`);
console.log(`  MCP Servers wired:   ${result.mcpServersCount}`);
console.log(`  LSP Servers wired:   ${result.lspServersCount}`);
```

---

## 🚀 Live Interoperability Guarantee

With this adapter, any official Claude Code marketplace plugin (from Anthropic or the open-source ecosystem) works out-of-the-box in OpenCode!
