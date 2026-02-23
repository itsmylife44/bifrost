import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface SSHHostConfig {
  identityFiles: string[];
  user?: string | undefined;
  port?: number | undefined;
}

/**
 * Parse ~/.ssh/config and extract Host -> IdentityFile mappings.
 * Returns a map of hostname/pattern -> resolved identity file paths.
 * Supports tilde expansion and basic Host matching (no wildcards).
 */
export function parseSSHConfig(): Map<string, SSHHostConfig> {
  const configPath = join(homedir(), ".ssh", "config");
  if (!existsSync(configPath)) return new Map();

  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {
    return new Map();
  }

  const result = new Map<string, SSHHostConfig>();
  let currentHosts: string[] = [];
  let currentIdentityFiles: string[] = [];
  let currentUser: string | undefined;
  let currentPort: number | undefined;

  function flushBlock(): void {
    if (currentHosts.length === 0) return;

    const config: SSHHostConfig = {
      identityFiles: currentIdentityFiles,
      user: currentUser,
      port: currentPort,
    };

    for (const host of currentHosts) {
      // Skip wildcard-only patterns
      if (host === "*") continue;
      result.set(host, config);
    }

    currentHosts = [];
    currentIdentityFiles = [];
    currentUser = undefined;
    currentPort = undefined;
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    // Skip comments and empty lines
    if (line === "" || line.startsWith("#")) continue;

    // Match "Key Value" or "Key=Value" format
    const match = line.match(/^(\S+)\s+(.+)$/) ?? line.match(/^(\S+)=(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    if (!key || !value) continue;

    const keyLower = key.toLowerCase();

    if (keyLower === "host") {
      flushBlock();
      // Host can have multiple space-separated patterns
      currentHosts = value.split(/\s+/).filter((h) => h.length > 0);
    } else if (keyLower === "identityfile") {
      let resolved = value.trim();
      // Expand ~ to home directory
      if (resolved.startsWith("~/") || resolved.startsWith("~\\")) {
        resolved = join(homedir(), resolved.slice(2));
      } else if (resolved === "~") {
        resolved = homedir();
      }
      // Only include if the file actually exists
      if (existsSync(resolved)) {
        currentIdentityFiles.push(resolved);
      }
    } else if (keyLower === "user") {
      currentUser = value.trim();
    } else if (keyLower === "port") {
      const parsed = Number(value.trim());
      if (!Number.isNaN(parsed) && Number.isInteger(parsed) && parsed > 0) {
        currentPort = parsed;
      }
    }
  }

  // Flush the last block
  flushBlock();

  return result;
}

/**
 * Find identity files from SSH config that match a given hostname.
 * Returns key paths (does NOT read key file contents).
 */
export function getSSHConfigKeysForHost(host: string): string[] {
  const sshConfig = parseSSHConfig();

  const direct = sshConfig.get(host);
  if (direct && direct.identityFiles.length > 0) {
    return direct.identityFiles;
  }

  return [];
}
