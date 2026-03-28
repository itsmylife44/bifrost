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

    const primaryKey = join(sshDir, "primary_test_key");
    const secondaryKey = join(sshDir, "secondary_test_key");
    writeFileSync(primaryKey, "private");
    writeFileSync(secondaryKey, "private");
    chmodSync(primaryKey, 0o600);
    chmodSync(secondaryKey, 0o600);

    configPath = join(sshDir, "config");
    writeFileSync(configPath, [
      "Host *",
      "    IdentitiesOnly yes",
      "",
      "Host example-alias",
      "    HostName ssh-target.example.test",
      "    User testuser",
      `    IdentityFile ${primaryKey}`,
      "",
      "Host second-target.example.test",
      "    User altuser",
      `    IdentityFile ${secondaryKey}`,
      "",
    ].join("\n"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps explicit host entries in parseSSHConfig", () => {
    const parsed = parseSSHConfigAtPath(configPath);
    expect(parsed.get("example-alias")?.identityFiles.length).toBeGreaterThan(0);
  });

  it("resolves wildcard IdentitiesOnly and specific alias hostname", () => {
    const resolved = resolveSSHConfigForHostAtPath("example-alias", configPath);
    expect(resolved.hostName).toBe("ssh-target.example.test");
    expect(resolved.user).toBe("testuser");
    expect(resolved.identitiesOnly).toBe(true);
    expect(resolved.identityFiles.some((file) => file.endsWith("primary_test_key"))).toBe(true);
  });

  it("resolves host-specific identity files for direct hostname entries", () => {
    const resolved = resolveSSHConfigForHostAtPath("second-target.example.test", configPath);
    expect(resolved.identityFiles.some((file) => file.endsWith("secondary_test_key"))).toBe(true);
  });

  it("applies top-level directives before any Host block as global defaults", () => {
    writeFileSync(configPath, [
      "IdentitiesOnly yes",
      "",
      "Host specific-host",
      "    User specificuser",
      "",
    ].join("\n"));

    const resolved = resolveSSHConfigForHostAtPath("any-random-host", configPath);
    expect(resolved.identitiesOnly).toBe(true);
  });

  it("honors negated host patterns as exclusions", () => {
    writeFileSync(configPath, [
      "Host * !blocked.example.com",
      "    IdentitiesOnly yes",
      "",
      "Host blocked.example.com",
      "    IdentityFile /tmp/blocked",
      "",
    ].join("\n"));

    expect(resolveSSHConfigForHostAtPath("allowed.example.com", configPath).identitiesOnly).toBe(true);
    expect(resolveSSHConfigForHostAtPath("blocked.example.com", configPath).identitiesOnly).toBeUndefined();
  });
});
