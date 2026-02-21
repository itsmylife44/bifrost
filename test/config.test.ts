import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BifrostConfigSchema, parseConfig } from "../src/config";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

describe("BifrostConfigSchema", () => {
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

      const result = BifrostConfigSchema.parse(input);

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
        keyPath: "/home/user/.ssh/id_rsa",
      };

      const result = BifrostConfigSchema.parse(input);

      expect(result.host).toBe("example.com");
      expect(result.keyPath).toBe("/home/user/.ssh/id_rsa");
      expect(result.user).toBe("root");
      expect(result.port).toBe(22);
      expect(result.connectTimeout).toBe(10);
      expect(result.serverAliveInterval).toBe(30);
    });
  });

  describe("invalid config validation", () => {
    it("throws Zod error when host is missing", () => {
      const input = {
        keyPath: "/path/to/key",
      };

      expect(() => BifrostConfigSchema.parse(input)).toThrow();
    });

    it("throws Zod error when keyPath is missing", () => {
      const input = {
        host: "example.com",
      };

      expect(() => BifrostConfigSchema.parse(input)).toThrow();
    });

    it("throws Zod error for wrong types", () => {
      const input = {
        host: "example.com",
        keyPath: "/path/to/key",
        port: "not-a-number",
      };

      expect(() => BifrostConfigSchema.parse(input)).toThrow();
    });

    it("throws Zod error for negative port", () => {
      const input = {
        host: "example.com",
        keyPath: "/path/to/key",
        port: -1,
      };

      expect(() => BifrostConfigSchema.parse(input)).toThrow();
    });

    it("throws Zod error for non-integer port", () => {
      const input = {
        host: "example.com",
        keyPath: "/path/to/key",
        port: 22.5,
      };

      expect(() => BifrostConfigSchema.parse(input)).toThrow();
    });
  });
});

describe("parseConfig", () => {
  let tempDir: string;
  let keyPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bifrost-test-"));
    keyPath = join(tempDir, "test_key");
    writeFileSync(keyPath, "fake key content");
    chmodSync(keyPath, 0o600);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses valid config file with all fields", () => {
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

    expect(result.host).toBe("192.168.1.100");
    expect(result.user).toBe("admin");
    expect(result.keyPath).toBe(keyPath);
    expect(result.port).toBe(2222);
    expect(result.connectTimeout).toBe(30);
    expect(result.serverAliveInterval).toBe(60);
  });

  it("parses valid config file with only required fields", () => {
    const configPath = join(tempDir, "config.json");
    const config = {
      host: "example.com",
      keyPath: keyPath,
    };
    writeFileSync(configPath, JSON.stringify(config));

    const result = parseConfig(configPath);

    expect(result.host).toBe("example.com");
    expect(result.keyPath).toBe(keyPath);
    expect(result.user).toBe("root");
    expect(result.port).toBe(22);
    expect(result.connectTimeout).toBe(10);
    expect(result.serverAliveInterval).toBe(30);
  });

  it("throws error for missing host", () => {
    const configPath = join(tempDir, "config.json");
    const config = {
      keyPath: keyPath,
    };
    writeFileSync(configPath, JSON.stringify(config));

    expect(() => parseConfig(configPath)).toThrow(/host/i);
  });

  it("throws error for missing keyPath", () => {
    const configPath = join(tempDir, "config.json");
    const config = {
      host: "example.com",
    };
    writeFileSync(configPath, JSON.stringify(config));

    expect(() => parseConfig(configPath)).toThrow(/keyPath/i);
  });

  it("throws error for wrong types", () => {
    const configPath = join(tempDir, "config.json");
    const config = {
      host: "example.com",
      keyPath: keyPath,
      port: "not-a-number",
    };
    writeFileSync(configPath, JSON.stringify(config));

    expect(() => parseConfig(configPath)).toThrow();
  });

  it("expands tilde in keyPath", () => {
    const configPath = join(tempDir, "config.json");
    const homeKeyPath = join(homedir(), ".ssh", "bifrost-test-key");
    mkdirSync(join(homedir(), ".ssh"), { recursive: true });
    writeFileSync(homeKeyPath, "fake key content");
    chmodSync(homeKeyPath, 0o600);

    try {
      const config = {
        host: "example.com",
        keyPath: "~/.ssh/bifrost-test-key",
      };
      writeFileSync(configPath, JSON.stringify(config));

      const result = parseConfig(configPath);

      expect(result.keyPath).toBe(homeKeyPath);
    } finally {
      rmSync(homeKeyPath, { force: true });
    }
  });

  it("throws error when config file does not exist", () => {
    expect(() => parseConfig("/nonexistent/path/config.json")).toThrow(
      /Config file not found/
    );
  });

  it("throws error when key file does not exist", () => {
    const configPath = join(tempDir, "config.json");
    const config = {
      host: "example.com",
      keyPath: "/nonexistent/key",
    };
    writeFileSync(configPath, JSON.stringify(config));

    expect(() => parseConfig(configPath)).toThrow(/Key file not found/);
  });

  it("throws error for invalid JSON", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, "{ invalid json }");

    expect(() => parseConfig(configPath)).toThrow(/JSON parse error/);
  });
});
