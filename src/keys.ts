import { readdirSync, readFileSync, statSync, readSync, openSync, closeSync, existsSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import { isWindows } from "./paths";

const EXCLUDED_NAMES = new Set([
  "known_hosts",
  "known_hosts.old",
  "config",
  "authorized_keys",
  "authorized_keys2",
  "environment",
]);

const KEY_PRIORITY: Record<string, number> = {
  id_ed25519: 0,
  id_ecdsa: 1,
  id_rsa: 2,
  id_dsa: 3,
};

function isPrivateKeyFile(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(50);
    const bytesRead = readSync(fd, buf, 0, 50, 0);
    if (bytesRead === 0) return false;
    const header = buf.subarray(0, bytesRead).toString("utf-8");
    return header.startsWith("-----BEGIN");
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch {}
    }
  }
}

function hasSecurePermissions(filePath: string): boolean {
  if (isWindows()) return true;

  try {
    const stats = statSync(filePath);
    const mode = stats.mode & 0o777;
    // Allow 0o600 (rw-------) or 0o400 (r--------)
    return mode === 0o600 || mode === 0o400;
  } catch {
    return false;
  }
}

function keyPriority(filePath: string): number {
  const name = basename(filePath);
  const priority = KEY_PRIORITY[name];
  return priority !== undefined ? priority : 999;
}

/**
 * Discover SSH private keys in ~/.ssh/
 * Returns absolute paths sorted by priority (ed25519 > ecdsa > rsa > dsa > rest)
 */
export function discoverSSHKeys(): string[] {
  const sshDir = join(homedir(), ".ssh");

  if (!existsSync(sshDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(sshDir);
  } catch {
    return [];
  }

  const candidates: string[] = [];

  for (const entry of entries) {
    // Skip hidden files
    if (entry.startsWith(".")) continue;

    // Skip known non-key files
    if (EXCLUDED_NAMES.has(entry)) continue;

    // Skip public keys
    if (entry.endsWith(".pub")) continue;

    const fullPath = join(sshDir, entry);

    // Skip non-files (directories, sockets, symlinks)
    try {
      const stats = statSync(fullPath);
      if (!stats.isFile()) continue;
    } catch {
      continue;
    }

    // Check permissions (non-Windows only)
    if (!hasSecurePermissions(fullPath)) continue;

    // Verify it's actually a private key
    if (!isPrivateKeyFile(fullPath)) continue;

    candidates.push(fullPath);
  }

  // Sort by priority, then alphabetically for same-priority keys
  candidates.sort((a, b) => {
    const priorityA = keyPriority(a);
    const priorityB = keyPriority(b);
    if (priorityA !== priorityB) return priorityA - priorityB;
    return basename(a).localeCompare(basename(b));
  });

  return candidates;
}

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
 * Checks exact host match and Host alias match.
 */
export function getSSHConfigKeysForHost(host: string): string[] {
  const sshConfig = parseSSHConfig();

  // Direct match
  const direct = sshConfig.get(host);
  if (direct && direct.identityFiles.length > 0) {
    return direct.identityFiles;
  }

  // Check HostName-based match (if any alias resolves to this host)
  // For now, only exact hostname/alias matching is supported
  return [];
}
