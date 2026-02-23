import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BifrostServerSchema, BifrostConfigSchema, parseConfig, parseServerShorthand } from "../src/config";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

describe("BifrostServerSchema", () => {
  describe("valid config parsing", () => {
    it("parses config with all fields", () => {
      const input = {
        host: "192.168.1.100",
        user: "admin",
        keyPath: "/path/to/key",
        port: 2222,
        connectTimeout: 30,
        serverAliveInterval: 60,
      };

      const result = BifrostServerSchema.parse(input);

      expect(result.host).toBe("192.168.1.100");
      expect(result.user).toBe("admin");
      expect(result.keyPath).toBe("/path/to/key");
      expect(result.port).toBe(2222);
      expect(result.connectTimeout).toBe(30);
      expect(result.serverAliveInterval).toBe(60);
    });

    it("parses config with only required fields (defaults applied)", () => {
      const input = {
        host: "example.com",
      };

      const result = BifrostServerSchema.parse(input);

      expect(result.host).toBe("example.com");
      expect(result.keyPath).toBeUndefined();
      expect(result.user).toBe("root");
      expect(result.port).toBe(22);
      expect(result.connectTimeout).toBe(10);
      expect(result.serverAliveInterval).toBe(30);
    });

    it("allows optional keyPath", () => {
      const input = { host: "example.com" };
      const result = BifrostServerSchema.parse(input);
      expect(result.keyPath).toBeUndefined();
    });
  });

  describe("invalid config validation", () => {
    it("throws Zod error when host is missing", () => {
      const input = { keyPath: "/path/to/key" };
      expect(() => BifrostServerSchema.parse(input)).toThrow();
    });

    it("throws Zod error for wrong types", () => {
      const input = { host: "example.com", keyPath: "/path/to/key", port: "not-a-number" };
      expect(() => BifrostServerSchema.parse(input)).toThrow();
    });

    it("throws Zod error for negative port", () => {
      const input = { host: "example.com", keyPath: "/path/to/key", port: -1 };
      expect(() => BifrostServerSchema.parse(input)).toThrow();
    });

    it("throws Zod error for non-integer port", () => {
      const input = { host: "example.com", keyPath: "/path/to/key", port: 22.5 };
      expect(() => BifrostServerSchema.parse(input)).toThrow();
    });
  });
});

describe("BifrostConfigSchema (backward compat alias)", () => {
  it("is the same as BifrostServerSchema", () => {
    expect(BifrostConfigSchema).toBe(BifrostServerSchema);
  });
});

describe("parseServerShorthand", () => {
  it("parses bare IP", () => {
    expect(parseServerShorthand("1.2.3.4")).toEqual({ host: "1.2.3.4", user: "root", port: 22 });
  });

  it("parses bare hostname", () => {
    expect(parseServerShorthand("staging.example.com")).toEqual({ host: "staging.example.com", user: "root", port: 22 });
  });

  it("parses user@host", () => {
    expect(parseServerShorthand("root@1.2.3.4")).toEqual({ host: "1.2.3.4", user: "root", port: 22 });
  });

  it("parses user@host:port", () => {
    expect(parseServerShorthand("deploy@10.0.0.5:2222")).toEqual({ host: "10.0.0.5", user: "deploy", port: 2222 });
  });

  it("parses host:port without user", () => {
    expect(parseServerShorthand("10.0.0.5:2222")).toEqual({ host: "10.0.0.5", user: "root", port: 2222 });
  });

  it("throws on invalid host", () => {
    expect(() => parseServerShorthand("")).toThrow(/Invalid host/);
  });

  it("throws on invalid user", () => {
    expect(() => parseServerShorthand("123bad@1.2.3.4")).toThrow(/Invalid user/);
  });
});

describe("parseConfig", () => {
  let tempDir: string;
  let keyPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bifrost-test-"));
    keyPath = join(tempDir, "test_key");
    writeFileSync(keyPath, "-----BEGIN OPENSSH PRIVATE KEY-----\nfake key content\n-----END OPENSSH PRIVATE KEY-----");
    chmodSync(keyPath, 0o600);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("legacy format", () => {
    it("parses legacy config and wraps in multi-server format", () => {
      const configPath = join(tempDir, "config.json");
      const config = {
        host: "192.168.1.100",
        user: "admin",
        keyPath: keyPath,
        port: 2222,
        connectTimeout: 30,
        serverAliveInterval: 60,
      };
      writeFileSync(configPath, JSON.stringify(config));

      const result = parseConfig(configPath);

      expect(result.defaultServer).toBe("default");
      expect(result.keyDiscovery).toBe(false);
      expect(result.servers["default"]).toBeDefined();
      expect(result.servers["default"]!.host).toBe("192.168.1.100");
      expect(result.servers["default"]!.user).toBe("admin");
      expect(result.servers["default"]!.keyPath).toBe(keyPath);
      expect(result.servers["default"]!.port).toBe(2222);
    });

    it("parses legacy config with only required fields", () => {
      const configPath = join(tempDir, "config.json");
      const config = { host: "example.com", keyPath: keyPath };
      writeFileSync(configPath, JSON.stringify(config));

      const result = parseConfig(configPath);

      expect(result.servers["default"]!.host).toBe("example.com");
      expect(result.servers["default"]!.keyPath).toBe(keyPath);
      expect(result.servers["default"]!.user).toBe("root");
      expect(result.servers["default"]!.port).toBe(22);
    });

    it("expands tilde in legacy keyPath", () => {
      const configPath = join(tempDir, "config.json");
      const homeKeyPath = join(homedir(), ".ssh", "bifrost-test-key");
      mkdirSync(join(homedir(), ".ssh"), { recursive: true });
      writeFileSync(homeKeyPath, "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----");
      chmodSync(homeKeyPath, 0o600);

      try {
        writeFileSync(configPath, JSON.stringify({ host: "example.com", keyPath: "~/.ssh/bifrost-test-key" }));
        const result = parseConfig(configPath);
        expect(result.servers["default"]!.keyPath).toBe(homeKeyPath);
      } finally {
        rmSync(homeKeyPath, { force: true });
      }
    });
  });

  describe("multi-server format", () => {
    it("parses multi-server config", () => {
      const configPath = join(tempDir, "config.json");
      writeFileSync(configPath, JSON.stringify({
        servers: {
          main: { host: "192.168.1.100", keyPath: keyPath },
          staging: { host: "10.0.0.5", user: "deploy", port: 2222 },
        },
        default: "main",
      }));

      const result = parseConfig(configPath);

      expect(result.defaultServer).toBe("main");
      expect(result.keyDiscovery).toBe(true);
      expect(Object.keys(result.servers)).toHaveLength(2);
      expect(result.servers["main"]!.host).toBe("192.168.1.100");
      expect(result.servers["staging"]!.host).toBe("10.0.0.5");
      expect(result.servers["staging"]!.user).toBe("deploy");
      expect(result.servers["staging"]!.port).toBe(2222);
    });

    it("parses string shorthand servers", () => {
      const configPath = join(tempDir, "config.json");
      writeFileSync(configPath, JSON.stringify({ servers: { quick: "deploy@10.0.0.5:2222" } }));

      const result = parseConfig(configPath);
      expect(result.servers["quick"]!.host).toBe("10.0.0.5");
      expect(result.servers["quick"]!.user).toBe("deploy");
      expect(result.servers["quick"]!.port).toBe(2222);
    });

    it("defaults to first server when no default specified", () => {
      const configPath = join(tempDir, "config.json");
      writeFileSync(configPath, JSON.stringify({ servers: { alpha: { host: "1.2.3.4" }, beta: { host: "5.6.7.8" } } }));

      const result = parseConfig(configPath);
      expect(result.defaultServer).toBe("alpha");
    });

    it("throws when default server not in servers", () => {
      const configPath = join(tempDir, "config.json");
      writeFileSync(configPath, JSON.stringify({ servers: { main: { host: "1.2.3.4" } }, default: "nonexistent" }));
      expect(() => parseConfig(configPath)).toThrow(/Default server/);
    });

    it("throws when servers is empty", () => {
      const configPath = join(tempDir, "config.json");
      writeFileSync(configPath, JSON.stringify({ servers: {} }));
      expect(() => parseConfig(configPath)).toThrow(/at least one server/);
    });

    it("disables key discovery when set to false", () => {
      const configPath = join(tempDir, "config.json");
      writeFileSync(configPath, JSON.stringify({ servers: { main: { host: "1.2.3.4" } }, keyDiscovery: false }));

      const result = parseConfig(configPath);
      expect(result.keyDiscovery).toBe(false);
    });
  });

  describe("error handling", () => {
    it("throws error when config file does not exist", () => {
      expect(() => parseConfig("/nonexistent/path/config.json")).toThrow(/Config file not found/);
    });

    it("throws error when key file does not exist", () => {
      const configPath = join(tempDir, "config.json");
      writeFileSync(configPath, JSON.stringify({ host: "example.com", keyPath: "/nonexistent/key" }));
      expect(() => parseConfig(configPath)).toThrow(/Key file not found/);
    });

    it("throws error for invalid JSON", () => {
      const configPath = join(tempDir, "config.json");
      writeFileSync(configPath, "{ invalid json }");
      expect(() => parseConfig(configPath)).toThrow(/JSON parse error/);
    });
  });
});
