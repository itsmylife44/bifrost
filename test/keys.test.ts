import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseSSHConfigAtPath, resolveSSHConfigForHostAtPath } from "../src/keys";

describe("SSH config parsing", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bifrost-ssh-config-test-"));
    const sshDir = join(tempDir, ".ssh");
    mkdirSync(sshDir, { recursive: true });

    const projectKey = join(sshDir, "projects02");
    const marcoKey = join(sshDir, "marco_dev");
    writeFileSync(projectKey, "private");
    writeFileSync(marcoKey, "private");
    chmodSync(projectKey, 0o600);
    chmodSync(marcoKey, 0o600);

    configPath = join(sshDir, "config");
    writeFileSync(configPath, [
      "Host *",
      "    IdentitiesOnly yes",
      "",
      "Host projects02",
      "    HostName 148.251.116.102",
      "    User root",
      `    IdentityFile ${projectKey}`,
      "",
      "Host 148.251.116.101",
      "    User root",
      `    IdentityFile ${marcoKey}`,
      "",
    ].join("\n"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps explicit host entries in parseSSHConfig", () => {
    const parsed = parseSSHConfigAtPath(configPath);
    expect(parsed.get("projects02")?.identityFiles.length).toBeGreaterThan(0);
  });

  it("resolves wildcard IdentitiesOnly and specific alias hostname", () => {
    const resolved = resolveSSHConfigForHostAtPath("projects02", configPath);
    expect(resolved.hostName).toBe("148.251.116.102");
    expect(resolved.user).toBe("root");
    expect(resolved.identitiesOnly).toBe(true);
    expect(resolved.identityFiles.some((file) => file.endsWith("projects02"))).toBe(true);
  });

  it("resolves host-specific identity files for direct IP entries", () => {
    const resolved = resolveSSHConfigForHostAtPath("148.251.116.101", configPath);
    expect(resolved.identityFiles.some((file) => file.endsWith("marco_dev"))).toBe(true);
  });
});
