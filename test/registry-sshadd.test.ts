import { describe, it, expect } from "bun:test";
import { resolveAgentSocket, buildSshAddAttempts, shouldDowngradeSshAddFailure } from "../src/registry";

describe("Windows ssh-add safety behavior", () => {
  it("resolves pageant explicitly when provided in mixed case", () => {
    expect(resolveAgentSocket(true, "PaGeAnT")).toBe("pageant");
  });

  it("normalizes posix SSH_AUTH_SOCK to windows named pipe", () => {
    expect(resolveAgentSocket(true, "/tmp/ssh-foo/agent.1")).toBe("//./pipe/openssh-ssh-agent");
  });

  it("builds windows attempts with native OpenSSH first and PATH fallback second", () => {
    const attempts = buildSshAddAttempts(
      true,
      "C:\\Windows\\System32\\OpenSSH\\ssh-add.exe",
      "//./pipe/openssh-ssh-agent",
      { PATH: "C:\\Windows\\System32", SSH_AUTH_SOCK: "/tmp/legacy.sock" }
    );

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.label).toBe("windows-openssh");
    expect(attempts[0]?.command).toBe('"C:\\Windows\\System32\\OpenSSH\\ssh-add.exe"');
    expect(attempts[0]?.env.SSH_AUTH_SOCK).toBe("//./pipe/openssh-ssh-agent");
    expect(attempts[1]?.label).toBe("path-default");
    expect(attempts[1]?.command).toBe("ssh-add");
    expect(attempts[1]?.env.SSH_AUTH_SOCK).toBe("//./pipe/openssh-ssh-agent");
  });

  it("builds only PATH fallback on non-windows", () => {
    const attempts = buildSshAddAttempts(false, null, "/tmp/agent.sock", {
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/original.sock",
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.label).toBe("path-default");
    expect(attempts[0]?.command).toBe("ssh-add");
    expect(attempts[0]?.env.SSH_AUTH_SOCK).toBe("/tmp/agent.sock");
  });

  it("downgrades warning only on windows when agent identities are present", () => {
    expect(shouldDowngradeSshAddFailure(true, "//./pipe/openssh-ssh-agent", true)).toBe(true);
    expect(shouldDowngradeSshAddFailure(true, undefined, true)).toBe(false);
    expect(shouldDowngradeSshAddFailure(true, "//./pipe/openssh-ssh-agent", false)).toBe(false);
    expect(shouldDowngradeSshAddFailure(false, "/tmp/agent.sock", true)).toBe(false);
  });
});
