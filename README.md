# OpenCode Marketplace Engine (oh-my-pi / Claude Code Reference Architecture)

`opencode-marketplace-omp-ref` is a standalone, zero-dependency OpenCode plugin extension that brings **`oh-my-pi`'s native Marketplace Subsystem** and **Claude Code `marketplace.json` protocol support** directly into OpenCode.

## Features

- **Full `/marketplace` Interactive TUI Browser**: Keyboard-navigable dialog modal for discovering, installing, uninstalling, and managing plugins.
- **5 Plugin Source Resolution Strategies**:
  - **Relative Monorepo Paths** (`./plugins/my-plugin`)
  - **GitHub Repositories** (`github:owner/repo`)
  - **Git URLs** (`git+https://...`)
  - **Git Subdirectories** (`git+https://...#main:path/to/plugin`)
  - **npm Packages** (`npm:@org/plugin`)
- **Claude Code & OMP Compatibility**: Parses `.omp-plugin/marketplace.json` and `.claude-plugin/marketplace.json` manifests.
- **Scoped Registries**: Supports both User-Scoped (`~/.config/opencode/installed_plugins.json`) and Project-Scoped (`.opencode/plugins/installed_plugins.json`) installs.

## Installation into OpenCode

### Method 1: Using `opencode.jsonc` (Recommended)

Add the pre-built `dist/opencode-marketplace.js` directly to your global `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": [
    "https://raw.githubusercontent.com/Powerchu/opencode-marketplace-omp-ref/main/dist/opencode-marketplace.js"
  ]
}
```

### Method 2: Local Extension Linking

Clone this repository and link the build artifact:

```powershell
git clone https://github.com/Powerchu/opencode-marketplace-omp-ref.git
cd opencode-marketplace-omp-ref
bun run build

# Copy to global plugins
Copy-Item dist/opencode-marketplace.js "$env:USERPROFILE\.config\opencode\plugins\opencode-marketplace.js"
```

## Available Commands

| Command | Effect |
| :--- | :--- |
| `/marketplace` | Open interactive TUI plugin browser modal |
| `/marketplace add <source>` | Add catalog source (e.g. `anthropics/claude-plugins-official`) |
| `/marketplace discover [marketplace]` | Browse available plugins |
| `/marketplace install <name@marketplace>` | Install a plugin by namespaced ID |
| `/marketplace uninstall <name@marketplace>` | Uninstall an installed plugin |
| `/marketplace list` | List configured marketplace sources |
| `/marketplace installed` | List installed marketplace plugins |
| `/plugins list` | List all active plugins and paths |

## License

MIT © [Powerchu](https://github.com/Powerchu)
