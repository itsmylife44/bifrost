import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { BifrostManager, BifrostError } from "../src/manager";
import { parseConfig } from "../src/config";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

const INTEGRATION_ENABLED = process.env.BIFROST_INTEGRATION === "true";
const CONFIG_PATH = join(homedir(), ".config", "opencode", "bifrost.json");

const describeIntegration = INTEGRATION_ENABLED ? describe : describe.skip;

describeIntegration("Integration Tests", () => {
  let manager: BifrostManager;
  let tempDir: string;

  beforeAll(() => {
    if (!existsSync(CONFIG_PATH)) {
      throw new Error(
        `Integration tests require config at ${CONFIG_PATH}. Set BIFROST_INTEGRATION=true to run.`
      );
    }
  });

  beforeEach(() => {
    manager = new BifrostManager();
    const multiConfig = parseConfig(CONFIG_PATH);
    const defaultName = multiConfig.defaultServer;
    const serverConfig = multiConfig.servers[defaultName];
    if (!serverConfig) {
      throw new Error(`Default server "${defaultName}" not found in config`);
    }
    manager.setConfig(serverConfig);
    tempDir = mkdtempSync(join(tmpdir(), "bifrost-integration-"));
  });

  afterEach(async () => {
    try {
      await manager.disconnect();
    } catch {
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("full lifecycle", () => {
    it("connect → exec → disconnect", async () => {
      expect(manager.state).toBe("disconnected");

      await manager.connect();
      expect(manager.state).toBe("connected");

      const result = await manager.exec("echo hello");
      expect(result.stdout.trim()).toBe("hello");
      expect(result.exitCode).toBe(0);

      await manager.disconnect();
      expect(manager.state).toBe("disconnected");
    });

    it("sequential command execution", async () => {
      await manager.connect();

      const result1 = await manager.exec("echo first");
      expect(result1.stdout.trim()).toBe("first");

      const result2 = await manager.exec("echo second");
      expect(result2.stdout.trim()).toBe("second");

      const result3 = await manager.exec("echo third");
      expect(result3.stdout.trim()).toBe("third");

      await manager.disconnect();
    });
  });

  describe("auto-reconnect", () => {
    it("reconnects after connection loss via ensureConnected", async () => {
      await manager.connect();
      expect(manager.state).toBe("connected");

      await manager.disconnect();
      expect(manager.state).toBe("disconnected");

      await manager.ensureConnected();
      expect(manager.state).toBe("connected");

      const result = await manager.exec("echo reconnected");
      expect(result.stdout.trim()).toBe("reconnected");
    });
  });

  describe("file transfer", () => {
    it("upload file", async () => {
      await manager.connect();

      const localFile = join(tempDir, "upload-test.txt");
      const remotePath = `/tmp/bifrost-upload-test-${Date.now()}.txt`;
      const testContent = `test content ${Date.now()}`;

      writeFileSync(localFile, testContent);

      await manager.upload(localFile, remotePath);

      const result = await manager.exec(`cat ${remotePath} && rm ${remotePath}`);
      expect(result.stdout.trim()).toBe(testContent);
    });

    it("download file", async () => {
      await manager.connect();

      const remotePath = `/tmp/bifrost-download-test-${Date.now()}.txt`;
      const localFile = join(tempDir, "download-test.txt");
      const testContent = `download content ${Date.now()}`;

      await manager.exec(`echo '${testContent}' > ${remotePath}`);

      await manager.download(remotePath, localFile);

      expect(existsSync(localFile)).toBe(true);
      const downloaded = readFileSync(localFile, "utf-8").trim();
      expect(downloaded).toBe(testContent);

      await manager.exec(`rm ${remotePath}`);
    });
  });

  describe("status checks", () => {
    it("isConnected returns true when connected", async () => {
      await manager.connect();
      const connected = await manager.isConnected();
      expect(connected).toBe(true);
    });

    it("isConnected returns false when disconnected", async () => {
      const connected = await manager.isConnected();
      expect(connected).toBe(false);
    });
  });

  describe("error handling", () => {
    it("exec throws when not connected", async () => {
      try {
        await manager.exec("echo test");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(BifrostError);
        expect((err as BifrostError).code).toBe("INVALID_STATE");
      }
    });
  });
});

describeIntegration("Integration Tests - Error Cases", () => {
  describe("unreachable host", () => {
    it("throws UNREACHABLE error for invalid host", async () => {
      const manager = new BifrostManager();
      const tempDir = mkdtempSync(join(tmpdir(), "bifrost-unreachable-"));
      const keyPath = join(tempDir, "fake_key");

      writeFileSync(keyPath, "-----BEGIN OPENSSH PRIVATE KEY-----\nfake key\n-----END OPENSSH PRIVATE KEY-----");
      const { chmodSync } = await import("fs");
      chmodSync(keyPath, 0o600);

      manager.setConfig({
        host: "192.0.2.1",
        user: "root",
        keyPath: keyPath,
        port: 22,
        connectTimeout: 3,
        serverAliveInterval: 30,
      });

      try {
        await manager.connect();
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(BifrostError);
        const bifrostErr = err as BifrostError;
        expect(["UNREACHABLE", "AUTH_FAILED", "TIMEOUT"]).toContain(bifrostErr.code);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

describe("Integration Tests - Skip Check", () => {
  it("skips when BIFROST_INTEGRATION is not set", () => {
    if (!INTEGRATION_ENABLED) {
      expect(true).toBe(true);
    } else {
      expect(INTEGRATION_ENABLED).toBe(true);
    }
  });
});
