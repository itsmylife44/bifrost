import { BifrostManager, BifrostError } from "./manager";
import type { ConnectionState } from "./manager";
import type { BifrostServerConfig, MultiServerConfig } from "./config";
import { parseConfig, expandTildePathPublic } from "./config";
import { getSSHConfigKeysForHost } from "./keys";
import { getDefaultConfigPath, isWindows } from "./paths";
import { execSync } from "child_process";

const WINDOWS_OPENSSH_AGENT_PIPE = "\\\\.\\pipe\\openssh-ssh-agent";

export interface ServerInfo {
  name: string;
  state: ConnectionState;
  host: string;
  user: string;
  port: number;
  isDefault: boolean;
  isActive: boolean;
}

export function resolveAgentSocket(isWin: boolean, sshAuthSock?: string): string | undefined {
  if (!isWin) return sshAuthSock;

  const envSock = sshAuthSock?.trim();
  if (!envSock) return WINDOWS_OPENSSH_AGENT_PIPE;

  const lower = envSock.toLowerCase();
  if (lower === "pageant") return "pageant";

  const isWindowsPipe = /^[/\\][/\\]\.[/\\]pipe[/\\].+/.test(envSock);
  const isLikelyPosixSock = envSock.startsWith("/");

  // In native cmd/powershell runs, a posix-looking SSH_AUTH_SOCK often comes
  // from another shell context and fails in ssh2's Windows agent path.
  // Prefer the native Windows OpenSSH agent named pipe for this case.
  if (!isWindowsPipe && isLikelyPosixSock) {
    return WINDOWS_OPENSSH_AGENT_PIPE;
  }

  return envSock;
}

function getAgentSocket(): string | undefined {
  return resolveAgentSocket(isWindows(), process.env["SSH_AUTH_SOCK"]);
}

function ensureKeysInAgent(config: BifrostServerConfig): void {
  const keyPaths: string[] = [];

  if (config.keyPath) {
    keyPaths.push(config.keyPath);
  }

  if (config.keys && config.keys.length > 0) {
    keyPaths.push(...config.keys);
  }

  if (keyPaths.length === 0) {
    const sshConfigKeys = getSSHConfigKeysForHost(config.host);
    keyPaths.push(...sshConfigKeys);
  }

  const windows = isWindows();
  const agentSocket = getAgentSocket();

  for (const keyPath of keyPaths) {
    const expanded = expandTildePathPublic(keyPath);
    try {
      execSync(`ssh-add "${expanded}"`, {
        stdio: "ignore",
        timeout: 10_000,
        env: windows && agentSocket
          ? { ...process.env, SSH_AUTH_SOCK: agentSocket }
          : process.env,
      });
    } catch {
      // ssh-add may fail if key is already loaded or agent is unavailable
    }
  }
}

export class BifrostRegistry {
  private managers = new Map<string, BifrostManager>();
  private _activeServer: string | null = null;
  private _defaultServer: string | null = null;
  private _config: MultiServerConfig | null = null;

  get activeServer(): string | null {
    return this._activeServer;
  }

  get defaultServer(): string | null {
    return this._defaultServer;
  }

  get config(): MultiServerConfig | null {
    return this._config;
  }

  loadConfig(configPath?: string): void {
    const path = configPath ?? getDefaultConfigPath();
    this._config = parseConfig(path);
    this._defaultServer = this._config.defaultServer;

    for (const [name, serverConfig] of Object.entries(this._config.servers)) {
      this.register(name, serverConfig);
    }
  }

  private register(name: string, config: BifrostServerConfig): void {
    const agentSocket = getAgentSocket();
    const manager = new BifrostManager();
    manager.setConfig(config);

    if (agentSocket) {
      manager.setAgent(agentSocket);
    }

    this.managers.set(name, manager);
  }

  private resolveName(serverName?: string): string {
    const name = serverName ?? this._activeServer ?? this._defaultServer;

    if (!name) {
      const firstKey = this.managers.keys().next();
      if (firstKey.done) {
        throw new BifrostError("No servers configured", "INVALID_STATE");
      }
      return firstKey.value;
    }

    if (!this.managers.has(name)) {
      throw new BifrostError(
        `Server "${name}" not found. Available: ${[...this.managers.keys()].join(", ")}`,
        "INVALID_STATE"
      );
    }

    return name;
  }

  getManager(serverName?: string): BifrostManager {
    const name = this.resolveName(serverName);
    const manager = this.managers.get(name);
    if (!manager) {
      throw new BifrostError(`Server "${name}" not found`, "INVALID_STATE");
    }
    return manager;
  }

  getServerConfig(serverName?: string): BifrostServerConfig | null {
    const name = this.resolveName(serverName);
    return this._config?.servers[name] ?? null;
  }

  async connect(serverName?: string): Promise<{ name: string; manager: BifrostManager }> {
    const name = this.resolveName(serverName);
    const config = this._config?.servers[name];

    if (config) {
      ensureKeysInAgent(config);
    }

    const manager = this.getManager(name);
    await manager.ensureConnected();
    this._activeServer = name;

    return { name, manager };
  }

  switchTo(name: string): void {
    if (!this.managers.has(name)) {
      throw new BifrostError(
        `Server "${name}" not found. Available: ${[...this.managers.keys()].join(", ")}`,
        "INVALID_STATE"
      );
    }
    this._activeServer = name;
  }

  listServers(): ServerInfo[] {
    const result: ServerInfo[] = [];

    for (const [name, manager] of this.managers) {
      const config = manager.config;
      result.push({
        name,
        state: manager.state,
        host: config?.host ?? "unknown",
        user: config?.user ?? "unknown",
        port: config?.port ?? 22,
        isDefault: name === this._defaultServer,
        isActive: name === this._activeServer,
      });
    }

    return result;
  }

  async disconnect(serverName?: string): Promise<void> {
    if (serverName) {
      const manager = this.managers.get(serverName);
      if (manager) {
        await manager.disconnect();
      }
      if (this._activeServer === serverName) {
        this._activeServer = null;
      }
      return;
    }

    for (const manager of this.managers.values()) {
      try {
        await manager.disconnect();
      } catch {}
    }
    this._activeServer = null;
  }

  get connectedCount(): number {
    let count = 0;
    for (const manager of this.managers.values()) {
      if (manager.state === "connected") count++;
    }
    return count;
  }

  get serverCount(): number {
    return this.managers.size;
  }
}

export const bifrostRegistry = new BifrostRegistry();
