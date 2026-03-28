import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface SSHHostConfig {
  hostName?: string | undefined;
  identityFiles: string[];
  user?: string | undefined;
  port?: number | undefined;
  identitiesOnly?: boolean | undefined;
}

interface SSHConfigBlock {
  patterns: string[];
  config: SSHHostConfig;
}

function expandHomePath(value: string): string {
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  if (value === "~") {
    return homedir();
  }
  return value;
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (["yes", "true", "on"].includes(normalized)) return true;
  if (["no", "false", "off"].includes(normalized)) return false;
  return undefined;
}

function hostPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesHostPattern(pattern: string, host: string): boolean {
  const negated = pattern.startsWith("!");
  const rawPattern = negated ? pattern.slice(1) : pattern;
  const matched = hostPatternToRegex(rawPattern).test(host);
  return negated ? !matched : matched;
}

function blockMatchesHost(patterns: string[], host: string): boolean {
  let hasPositiveMatch = false;

  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      if (matchesHostPattern(pattern, host)) return false;
      continue;
    }

    if (matchesHostPattern(pattern, host)) {
      hasPositiveMatch = true;
    }
  }

  return hasPositiveMatch;
}

function getDefaultSSHConfigPath(): string {
  return join(homedir(), ".ssh", "config");
}

function parseSSHConfigBlocks(configPath = getDefaultSSHConfigPath()): SSHConfigBlock[] {
  if (!existsSync(configPath)) return [];

  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {
    return [];
  }

  const blocks: SSHConfigBlock[] = [];
  let currentPatterns: string[] = [];
  let currentConfig: SSHHostConfig = { identityFiles: [] };

  function flushBlock(): void {
    if (currentPatterns.length === 0) return;
    blocks.push({
      patterns: currentPatterns,
      config: {
        hostName: currentConfig.hostName,
        identityFiles: [...currentConfig.identityFiles],
        user: currentConfig.user,
        port: currentConfig.port,
        identitiesOnly: currentConfig.identitiesOnly,
      },
    });
    currentPatterns = [];
    currentConfig = { identityFiles: [] };
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = line.match(/^(\S+)\s+(.+)$/) ?? line.match(/^(\S+)=(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    if (!key || !value) continue;

    const keyLower = key.toLowerCase();
    const trimmedValue = value.trim();

    if (keyLower === "host") {
      flushBlock();
      currentPatterns = trimmedValue.split(/\s+/).filter((h) => h.length > 0);
      continue;
    }

    if (currentPatterns.length === 0) continue;

    if (keyLower === "hostname") {
      currentConfig.hostName = trimmedValue;
    } else if (keyLower === "identityfile") {
      const resolved = expandHomePath(trimmedValue);
      currentConfig.identityFiles.push(resolved);
    } else if (keyLower === "user") {
      currentConfig.user = trimmedValue;
    } else if (keyLower === "port") {
      const parsed = Number(trimmedValue);
      if (!Number.isNaN(parsed) && Number.isInteger(parsed) && parsed > 0) {
        currentConfig.port = parsed;
      }
    } else if (keyLower === "identitiesonly") {
      currentConfig.identitiesOnly = parseBoolean(trimmedValue);
    }
  }

  flushBlock();
  return blocks;
}

/**
 * Parse ~/.ssh/config and extract Host -> config mappings.
 */
export function parseSSHConfig(): Map<string, SSHHostConfig> {
  return parseSSHConfigAtPath(getDefaultSSHConfigPath());
}

export function parseSSHConfigAtPath(configPath: string): Map<string, SSHHostConfig> {
  const result = new Map<string, SSHHostConfig>();

  for (const block of parseSSHConfigBlocks(configPath)) {
    for (const pattern of block.patterns) {
      if (pattern === "*") continue;
      result.set(pattern, block.config);
    }
  }

  return result;
}

export function resolveSSHConfigForHost(host: string): SSHHostConfig {
  return resolveSSHConfigForHostAtPath(host);
}

export function resolveSSHConfigForHostAtPath(host: string, configPath = getDefaultSSHConfigPath()): SSHHostConfig {
  const merged: SSHHostConfig = { identityFiles: [] };

  for (const block of parseSSHConfigBlocks(configPath)) {
    if (!blockMatchesHost(block.patterns, host)) continue;

    if (merged.hostName === undefined && block.config.hostName !== undefined) {
      merged.hostName = block.config.hostName;
    }
    if (merged.user === undefined && block.config.user !== undefined) {
      merged.user = block.config.user;
    }
    if (merged.port === undefined && block.config.port !== undefined) {
      merged.port = block.config.port;
    }
    if (merged.identitiesOnly === undefined && block.config.identitiesOnly !== undefined) {
      merged.identitiesOnly = block.config.identitiesOnly;
    }

    for (const identityFile of block.config.identityFiles) {
      if (!merged.identityFiles.includes(identityFile) && existsSync(identityFile)) {
        merged.identityFiles.push(identityFile);
      }
    }
  }

  return merged;
}

/**
 * Find identity files from SSH config that match a given hostname.
 * Returns key paths (does NOT read key file contents).
 */
export function getSSHConfigKeysForHost(host: string): string[] {
  return resolveSSHConfigForHost(host).identityFiles;
}
