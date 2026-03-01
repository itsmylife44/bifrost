import { describe, it, expect } from "bun:test";
import { resolveAgentSocket } from "../src/registry";

describe("Windows ssh-add safety behavior", () => {
  it("resolves pageant explicitly when provided in mixed case", () => {
    expect(resolveAgentSocket(true, "PaGeAnT")).toBe("pageant");
  });

  it("normalizes posix SSH_AUTH_SOCK to windows named pipe", () => {
    expect(resolveAgentSocket(true, "/tmp/ssh-foo/agent.1")).toBe("//./pipe/openssh-ssh-agent");
  });
});
