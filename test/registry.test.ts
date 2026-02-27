import { describe, it, expect } from "bun:test";
import { resolveAgentSocket } from "../src/registry";

describe("resolveAgentSocket", () => {
  it("returns OpenSSH named pipe on windows when SSH_AUTH_SOCK is missing", () => {
    expect(resolveAgentSocket(true, undefined)).toBe("\\\\.\\pipe\\openssh-ssh-agent");
    expect(resolveAgentSocket(true, "")).toBe("\\\\.\\pipe\\openssh-ssh-agent");
    expect(resolveAgentSocket(true, "   ")).toBe("\\\\.\\pipe\\openssh-ssh-agent");
  });

  it("keeps windows named pipe SSH_AUTH_SOCK on windows", () => {
    const pipePath = "\\\\.\\pipe\\openssh-ssh-agent";
    expect(resolveAgentSocket(true, pipePath)).toBe(pipePath);
  });

  it("falls back to OpenSSH named pipe for posix-style SSH_AUTH_SOCK on windows", () => {
    expect(resolveAgentSocket(true, "/tmp/ssh-1234/agent.1")).toBe("\\\\.\\pipe\\openssh-ssh-agent");
  });

  it("keeps explicit pageant value on windows", () => {
    expect(resolveAgentSocket(true, "pageant")).toBe("pageant");
  });

  it("returns SSH_AUTH_SOCK unchanged on non-windows", () => {
    expect(resolveAgentSocket(false, undefined)).toBeUndefined();
    expect(resolveAgentSocket(false, "/tmp/ssh-1234/agent.1")).toBe("/tmp/ssh-1234/agent.1");
  });
});
