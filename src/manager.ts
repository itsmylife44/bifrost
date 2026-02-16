import { mkdirSync, readdirSync, unlinkSync, chmodSync } from "fs";
import type { BifrostConfig } from "./config";
import { parseConfig } from "./config";
import { getSocketDir, isWindows } from "./paths";

export type ConnectionState = 
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting";

export type BifrostErrorCode = 
  | "UNREACHABLE" 
  | "AUTH_FAILED" 
  | "SOCKET_DEAD" 
  | "COMMAND_FAILED" 
  | "INVALID_STATE"
  | "TIMEOUT";

export class BifrostError extends Error {
  public override readonly name = "BifrostError" as const;
  
  constructor(
    message: string,
    public readonly code: BifrostErrorCode
  ) {
    super(message);
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOptions {
  timeout?: number;
  maxOutputBytes?: number;
}

const SOCKET_DIR = getSocketDir();
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024;

function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new BifrostError(`${operation} timed out after ${ms}ms`, "TIMEOUT")), ms)
    )
  ]);
}

async function readStreamLimited(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      if (totalBytes + value.length > maxBytes) {
        const remaining = maxBytes - totalBytes;
        if (remaining > 0) {
          chunks.push(value.slice(0, remaining));
        }
        truncated = true;
        break;
      }
      
      chunks.push(value);
      totalBytes += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(Math.min(totalBytes, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(combined);
  return truncated ? text + `\n... [truncated at ${maxBytes} bytes]` : text;
}

export class BifrostManager implements AsyncDisposable {
  private _state: ConnectionState = "disconnected";
  private _config: BifrostConfig | null = null;
  private _controlPath: string | null = null;
  private _mutex: Promise<void> = Promise.resolve();

  /**
   * Explicit Resource Management (ES2024)
   * Enables: `await using manager = new BifrostManager()`
   * Auto-disconnects when scope exits
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  get state(): ConnectionState {
    return this._state;
  }

  get config(): BifrostConfig | null {
    return this._config;
  }

  get controlPath(): string | null {
    return this._controlPath;
  }

  get socketDir(): string {
    return SOCKET_DIR;
  }

  private async withMutex<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this._mutex;
    let resolve: () => void;
    this._mutex = new Promise<void>(r => { resolve = r; });
    
    try {
      await prev;
      return await fn();
    } finally {
      resolve!();
    }
  }

  loadConfig(configPath: string): void {
    this._config = parseConfig(configPath);
    this._controlPath = `${SOCKET_DIR}/%C`;
  }

  private async ensureSocketDir(): Promise<void> {
    try {
      mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o700 });

      if (!isWindows()) {
        chmodSync(SOCKET_DIR, 0o700);
      }
    } catch (err) {
      throw new BifrostError(
        `Failed to create socket directory: ${err instanceof Error ? err.message : String(err)}`,
        "COMMAND_FAILED"
      );
    }
  }

  private translateSSHError(exitCode: number, stderr: string): BifrostError {
    const stderrLower = stderr.toLowerCase();
    
    if (exitCode === 255) {
      if (stderrLower.includes("permission denied") || 
          stderrLower.includes("authentication failed") ||
          stderrLower.includes("publickey")) {
        return new BifrostError(
          `Authentication failed. Check key at ${this._config?.keyPath}`,
          "AUTH_FAILED"
        );
      }
      if (stderrLower.includes("connection refused") ||
          stderrLower.includes("no route to host") ||
          stderrLower.includes("connection timed out") ||
          stderrLower.includes("could not resolve")) {
        return new BifrostError(
          `Server unreachable at ${this._config?.host}:${this._config?.port}`,
          "UNREACHABLE"
        );
      }
      return new BifrostError(
        `SSH connection error: ${stderr}`,
        "UNREACHABLE"
      );
    }
    
    return new BifrostError(
      `Command failed with exit code ${exitCode}: ${stderr}`,
      "COMMAND_FAILED"
    );
  }

  private getDestination(): string {
    if (!this._config) {
      throw new BifrostError("No config loaded", "INVALID_STATE");
    }
    return `${this._config.user}@${this._config.host}`;
  }

  async connect(): Promise<void> {
    return this.withMutex(async () => {
      if (this._state === "connected") {
        return;
      }
      
      if (this._state === "connecting" || this._state === "disconnecting") {
        throw new BifrostError(`Cannot connect in state: ${this._state}`, "INVALID_STATE");
      }
      
      if (!this._config) {
        throw new BifrostError("No config loaded. Call loadConfig() first", "INVALID_STATE");
      }

      this._state = "connecting";

      try {
        this.cleanup();
        await this.ensureSocketDir();
        await this.doConnect();
        this._state = "connected";
      } catch (error) {
        this._state = "disconnected";
        throw error;
      }
    });
  }

  async disconnect(): Promise<void> {
    return this.withMutex(async () => {
      if (this._state === "disconnected") {
        return;
      }
      
      if (this._state === "disconnecting" || this._state === "connecting") {
        throw new BifrostError(`Cannot disconnect in state: ${this._state}`, "INVALID_STATE");
      }

      if (!this._config || !this._controlPath) {
        this._state = "disconnected";
        return;
      }

      this._state = "disconnecting";

      try {
        const args = [
          "ssh",
          "-O", "exit",
          "-o", `ControlPath=${this._controlPath}`,
          this.getDestination(),
        ];

        const proc = Bun.spawn(args, {
          stdout: "pipe",
          stderr: "pipe",
        });

        await withTimeout(proc.exited, 5000, "SSH disconnect");
      } catch {
      } finally {
        this._state = "disconnected";
      }
    });
  }

  /**
   * Health check via ssh -O check
   * Returns true if connection is alive
   */
  async isConnected(): Promise<boolean> {
    if (this._state !== "connected" || !this._config || !this._controlPath) {
      return false;
    }

    const args = [
      "ssh",
      "-O", "check",
      "-o", `ControlPath=${this._controlPath}`,
      this.getDestination(),
    ];

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    return exitCode === 0;
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

    if (this._state !== "connected") {
      throw new BifrostError(
        `Cannot exec in state: ${this._state}. Call connect() first`,
        "INVALID_STATE"
      );
    }

    if (!this._config || !this._controlPath) {
      throw new BifrostError("No config or control path", "INVALID_STATE");
    }

    const alive = await this.isConnected();
    if (!alive) {
      this._state = "disconnected";
      throw new BifrostError(
        "Connection dead. Socket exists but connection failed",
        "SOCKET_DEAD"
      );
    }

    const escapedCommand = command.replace(/'/g, "'\\''");

    const args = [
      "ssh",
      "-o", `ControlPath=${this._controlPath}`,
      this.getDestination(),
      `bash -l -c '${escapedCommand}'`,
    ];

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const exitCode = await withTimeout(proc.exited, timeout, "Command execution");
      const [stdout, stderr] = await Promise.all([
        readStreamLimited(proc.stdout, maxOutput),
        readStreamLimited(proc.stderr, maxOutput),
      ]);

      return { stdout, stderr, exitCode };
    } catch (error) {
      proc.kill();
      throw error;
    }
  }

  private async runSftp(sftpCommand: string, timeout: number = 60000): Promise<void> {
    if (this._state !== "connected") {
      throw new BifrostError(
        `Cannot run SFTP in state: ${this._state}. Call connect() first`,
        "INVALID_STATE"
      );
    }

    if (!this._config || !this._controlPath) {
      throw new BifrostError("No config or control path", "INVALID_STATE");
    }

    const args = [
      "sftp",
      "-o", `ControlPath=${this._controlPath}`,
      "-b", "-",
      this.getDestination(),
    ];
    
    const proc = Bun.spawn(args, {
      stdin: new Response(sftpCommand).body,
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const exitCode = await withTimeout(proc.exited, timeout, "SFTP operation");
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        throw this.translateSSHError(exitCode, stderr);
      }
    } catch (error) {
      proc.kill();
      throw error;
    }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    await this.runSftp(`put -r "${localPath}" "${remotePath}"`);
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    await this.runSftp(`get -r "${remotePath}" "${localPath}"`);
  }

  async ensureConnected(): Promise<void> {
    return this.withMutex(async () => {
      if (this._state === "disconnected") {
        this._state = "connecting";
        try {
          this.cleanup();
          await this.ensureSocketDir();
          await this.doConnect();
          this._state = "connected";
        } catch (error) {
          this._state = "disconnected";
          throw error;
        }
        return;
      }

      if (this._state === "connecting" || this._state === "disconnecting") {
        throw new BifrostError(
          `Cannot ensure connection in state: ${this._state}`,
          "INVALID_STATE"
        );
      }

      const alive = await this.isConnected();
      if (!alive) {
        this._state = "connecting";
        try {
          await this.doConnect();
          this._state = "connected";
        } catch (error) {
          this._state = "disconnected";
          throw error;
        }
      }
    });
  }

  private async doConnect(): Promise<void> {
    if (!this._config) {
      throw new BifrostError("No config loaded", "INVALID_STATE");
    }

    const args = [
      "ssh",
      "-fN",
      "-o", "ControlMaster=auto",
      "-o", `ControlPath=${this._controlPath}`,
      "-o", `ControlPersist=${this._config.controlPersist}`,
      "-o", `ServerAliveInterval=${this._config.serverAliveInterval}`,
      "-o", `ConnectTimeout=${this._config.connectTimeout}`,
      "-o", "StrictHostKeyChecking=accept-new",
      "-i", this._config.keyPath,
      "-p", String(this._config.port),
      this.getDestination(),
    ];

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutMs = (this._config.connectTimeout + 5) * 1000;
    const exitCode = await withTimeout(proc.exited, timeoutMs, "SSH connect");
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      throw this.translateSSHError(exitCode, stderr);
    }
  }

  cleanup(): void {
    try {
      const files = readdirSync(SOCKET_DIR);
      for (const file of files) {
        try {
          unlinkSync(`${SOCKET_DIR}/${file}`);
        } catch {}
      }
    } catch {}
  }
}

export const bifrostManager = new BifrostManager();
