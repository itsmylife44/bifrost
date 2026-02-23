import { Client, type SFTPWrapper } from "ssh2";
import type { BifrostServerConfig } from "./config";

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

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024;

export class BifrostManager implements AsyncDisposable {
  private _state: ConnectionState = "disconnected";
  private _config: BifrostServerConfig | null = null;
  private _client: Client | null = null;
  private _mutex: Promise<void> = Promise.resolve();
  private _agent: string | undefined;

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  get state(): ConnectionState {
    return this._state;
  }

  get config(): BifrostServerConfig | null {
    return this._config;
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

  setConfig(config: BifrostServerConfig): void {
    this._config = config;
  }

  setAgent(agent: string): void {
    this._agent = agent;
  }

  private translateSSHError(err: Error): BifrostError {
    const msg = err.message.toLowerCase();
    
    if (msg.includes("authentication") || 
        msg.includes("permission denied") ||
        msg.includes("publickey") ||
        msg.includes("all configured authentication methods failed")) {
      return new BifrostError(
        `Authentication failed for ${this._config?.user}@${this._config?.host}. Ensure your key is loaded in ssh-agent (ssh-add).`,
        "AUTH_FAILED"
      );
    }
    if (msg.includes("connection refused") ||
        msg.includes("no route to host") ||
        msg.includes("timed out") ||
        msg.includes("could not resolve") ||
        msg.includes("getaddrinfo") ||
        msg.includes("econnrefused") ||
        msg.includes("etimedout") ||
        msg.includes("ehostunreach") ||
        msg.includes("enotfound")) {
      return new BifrostError(
        `Server unreachable at ${this._config?.host}:${this._config?.port}`,
        "UNREACHABLE"
      );
    }
    
    return new BifrostError(
      `SSH error: ${err.message}`,
      "COMMAND_FAILED"
    );
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
        throw new BifrostError("No config loaded. Call setConfig() first", "INVALID_STATE");
      }

      this._state = "connecting";

      try {
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

      this._state = "disconnecting";

      try {
        if (this._client) {
          this._client.end();
          this._client = null;
        }
      } finally {
        this._state = "disconnected";
      }
    });
  }

  async isConnected(): Promise<boolean> {
    if (this._state !== "connected" || !this._client) {
      return false;
    }

    try {
      await this.execRaw("echo 1", { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    if (this._state !== "connected") {
      throw new BifrostError(
        `Cannot exec in state: ${this._state}. Call connect() first`,
        "INVALID_STATE"
      );
    }

    if (!this._client) {
      throw new BifrostError("No SSH client", "INVALID_STATE");
    }

    return this.execRaw(command, options);
  }

  private async execRaw(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

    if (!this._client) {
      throw new BifrostError("No SSH client", "INVALID_STATE");
    }

    const client = this._client;

    return new Promise<ExecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new BifrostError(`Command execution timed out after ${timeout}ms`, "TIMEOUT"));
      }, timeout);

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(this.translateSSHError(err));
          return;
        }

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let stdoutTruncated = false;
        let stderrTruncated = false;

        stream.on("data", (data: Buffer) => {
          if (stdoutBytes < maxOutput) {
            const remaining = maxOutput - stdoutBytes;
            if (data.length > remaining) {
              stdoutChunks.push(data.subarray(0, remaining));
              stdoutTruncated = true;
            } else {
              stdoutChunks.push(data);
            }
            stdoutBytes += data.length;
          }
        });

        stream.stderr.on("data", (data: Buffer) => {
          if (stderrBytes < maxOutput) {
            const remaining = maxOutput - stderrBytes;
            if (data.length > remaining) {
              stderrChunks.push(data.subarray(0, remaining));
              stderrTruncated = true;
            } else {
              stderrChunks.push(data);
            }
            stderrBytes += data.length;
          }
        });

        stream.on("close", (code: number | null) => {
          clearTimeout(timer);

          let stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          let stderr = Buffer.concat(stderrChunks).toString("utf-8");

          if (stdoutTruncated) {
            stdout += `\n... [truncated at ${maxOutput} bytes]`;
          }
          if (stderrTruncated) {
            stderr += `\n... [truncated at ${maxOutput} bytes]`;
          }

          resolve({
            stdout,
            stderr,
            exitCode: code ?? -1,
          });
        });

        stream.on("error", (streamErr: Error) => {
          clearTimeout(timer);
          reject(this.translateSSHError(streamErr));
        });
      });
    });
  }

  private async getSftp(): Promise<SFTPWrapper> {
    if (this._state !== "connected" || !this._client) {
      throw new BifrostError(
        `Cannot run SFTP in state: ${this._state}. Call connect() first`,
        "INVALID_STATE"
      );
    }

    const client = this._client;

    return new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(this.translateSSHError(err));
          return;
        }
        resolve(sftp);
      });
    });
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp();

    return new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => {
        sftp.end();
        if (err) {
          reject(new BifrostError(
            `Upload failed: ${err.message}`,
            "COMMAND_FAILED"
          ));
          return;
        }
        resolve();
      });
    });
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    const sftp = await this.getSftp();

    return new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err) => {
        sftp.end();
        if (err) {
          reject(new BifrostError(
            `Download failed: ${err.message}`,
            "COMMAND_FAILED"
          ));
          return;
        }
        resolve();
      });
    });
  }

  async ensureConnected(): Promise<void> {
    return this.withMutex(async () => {
      if (this._state === "disconnected") {
        this._state = "connecting";
        try {
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

      if (!this._client) {
        this._state = "connecting";
        try {
          await this.doConnect();
          this._state = "connected";
        } catch (error) {
          this._state = "disconnected";
          throw error;
        }
        return;
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Health check timeout")), 5000);
          this._client!.exec("echo 1", (err, stream) => {
            if (err) {
              clearTimeout(timer);
              reject(err);
              return;
            }
            stream.on("close", () => {
              clearTimeout(timer);
              resolve();
            });
            stream.on("error", (e: Error) => {
              clearTimeout(timer);
              reject(e);
            });
            stream.resume();
          });
        });
      } catch {
        if (this._client) {
          try { this._client.end(); } catch {}
          this._client = null;
        }
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

    const config = this._config;

    if (this._client) {
      try { this._client.end(); } catch {}
      this._client = null;
    }

    if (!this._agent) {
      throw new BifrostError(
        "No SSH agent available. Set SSH_AUTH_SOCK (Unix/Mac) or use Pageant (Windows).",
        "AUTH_FAILED"
      );
    }

    const client = new Client();
    this._client = client;

    const timeoutMs = (config.connectTimeout + 5) * 1000;

    const connectConfig: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      username: config.user,
      readyTimeout: timeoutMs,
      keepaliveInterval: config.serverAliveInterval * 1000,
      keepaliveCountMax: 3,
      agent: this._agent,
    };

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.end();
        reject(new BifrostError(
          `SSH connect timed out after ${timeoutMs}ms`,
          "TIMEOUT"
        ));
      }, timeoutMs);

      client.on("ready", () => {
        clearTimeout(timer);
        resolve();
      });

      client.on("error", (err: Error) => {
        clearTimeout(timer);
        this._client = null;
        reject(this.translateSSHError(err));
      });

      client.on("close", () => {
        if (this._state === "connected") {
          this._state = "disconnected";
          this._client = null;
        }
      });

      client.connect(connectConfig as Parameters<Client["connect"]>[0]);
    });
  }

  cleanup(): void {}
}
