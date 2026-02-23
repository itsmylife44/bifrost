import { readdirSync, statSync, readSync, openSync, closeSync, existsSync } from "fs";
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
