import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BifrostManager, BifrostError } from "../src/manager";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, statSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

describe("BifrostManager", () => {
  let manager: BifrostManager;
  let tempDir: string;
  let keyPath: string;
  let configPath: string;

  beforeEach(() => {
    manager = new BifrostManager();
    tempDir = mkdtempSync(join(tmpdir(), "bifrost-manager-test-"));
    keyPath = join(tempDir, "test_key");
    configPath = join(tempDir, "config.json");

    writeFileSync(keyPath, "fake key content");
    chmodSync(keyPath, 0o600);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("initial state", () => {
    it("starts in disconnected state", () => {
      expect(manager.state).toBe("disconnected");
    });

    it("has null config initially", () => {
      expect(manager.config).toBeNull();
    });

    it("has null controlPath initially", () => {
      expect(manager.controlPath).toBeNull();
    });
  });

  describe("loadConfig", () => {
    it("loads valid config", () => {
      const config = {
        host: "192.168.1.100",
        user: "admin",
        keyPath: keyPath,
      };
      writeFileSync(configPath, JSON.stringify(config));

      manager.loadConfig(configPath);

      expect(manager.config).not.toBeNull();
      expect(manager.config!.host).toBe("192.168.1.100");
      expect(manager.config!.user).toBe("admin");
    });

    it("sets controlPath after loading config", () => {
      const config = {
        host: "192.168.1.100",
        keyPath: keyPath,
      };
      writeFileSync(configPath, JSON.stringify(config));

      manager.loadConfig(configPath);

      expect(manager.controlPath).not.toBeNull();
      expect(manager.controlPath).toContain("%C");
    });

    it("throws on missing config file", () => {
      expect(() => manager.loadConfig("/nonexistent/config.json")).toThrow(
        /Config file not found/
      );
    });
  });

  describe("socket path generation", () => {
    it("uses %C hash pattern for socket path", () => {
      const config = {
        host: "192.168.1.100",
        keyPath: keyPath,
      };
      writeFileSync(configPath, JSON.stringify(config));

      manager.loadConfig(configPath);

      expect(manager.controlPath).toContain("%C");
    });

    it("socket path is in socketDir", () => {
      const config = {
        host: "192.168.1.100",
        keyPath: keyPath,
      };
      writeFileSync(configPath, JSON.stringify(config));

      manager.loadConfig(configPath);

      expect(manager.controlPath).toContain(manager.socketDir);
    });
  });

  describe("socketDir permissions", () => {
    it("socketDir path ends with bifrost-control", () => {
      expect(manager.socketDir).toContain("bifrost-control");
    });

    it("socketDir is under .ssh directory", () => {
      expect(manager.socketDir).toContain(".ssh");
    });
  });

  describe("isConnected", () => {
    it("returns false when disconnected", async () => {
      expect(await manager.isConnected()).toBe(false);
    });

    it("returns false when config not loaded", async () => {
      expect(await manager.isConnected()).toBe(false);
    });
  });

  describe("connect without config", () => {
    it("throws INVALID_STATE error", async () => {
      try {
        await manager.connect();
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(BifrostError);
        expect((err as BifrostError).code).toBe("INVALID_STATE");
      }
    });
  });

  describe("exec without connection", () => {
    it("throws INVALID_STATE error", async () => {
      try {
        await manager.exec("echo hello");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(BifrostError);
        expect((err as BifrostError).code).toBe("INVALID_STATE");
      }
    });
  });

  describe("upload without connection", () => {
    it("throws INVALID_STATE error", async () => {
      try {
        await manager.upload("/local/path", "/remote/path");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(BifrostError);
        expect((err as BifrostError).code).toBe("INVALID_STATE");
      }
    });
  });

  describe("download without connection", () => {
    it("throws INVALID_STATE error", async () => {
      try {
        await manager.download("/remote/path", "/local/path");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(BifrostError);
        expect((err as BifrostError).code).toBe("INVALID_STATE");
      }
    });
  });

  describe("disconnect when already disconnected", () => {
    it("is a no-op", async () => {
      await manager.disconnect();
      expect(manager.state).toBe("disconnected");
    });
  });
});

describe("BifrostError", () => {
  it("has correct name", () => {
    const error = new BifrostError("test message", "UNREACHABLE");
    expect(error.name).toBe("BifrostError");
  });

  it("has correct message", () => {
    const error = new BifrostError("test message", "UNREACHABLE");
    expect(error.message).toBe("test message");
  });

  it("has correct code", () => {
    const error = new BifrostError("test message", "AUTH_FAILED");
    expect(error.code).toBe("AUTH_FAILED");
  });

  it("supports all error codes", () => {
    const codes = [
      "UNREACHABLE",
      "AUTH_FAILED",
      "SOCKET_DEAD",
      "COMMAND_FAILED",
      "INVALID_STATE",
    ] as const;

    for (const code of codes) {
      const error = new BifrostError(`Error with ${code}`, code);
      expect(error.code).toBe(code);
    }
  });
});
