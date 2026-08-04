import path from "node:path";
import type { PluginSource } from "./types";

export interface ResolveOptions {
  marketplaceRoot: string;
  cacheDir: string;
}

export async function resolvePluginSource(
  source: PluginSource,
  options: ResolveOptions
): Promise<string> {
  if (typeof source === "string") {
    if (source.startsWith("./") || source.startsWith("../")) {
      return path.resolve(options.marketplaceRoot, source);
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
