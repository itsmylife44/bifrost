import { BifrostManager, BifrostError } from "./manager";
import type { ConnectionState } from "./manager";
import type { BifrostServerConfig, MultiServerConfig } from "./config";
import { parseConfig } from "./config";
import { discoverSSHKeys } from "./keys";
import { getDefaultConfigPath } from "./paths";

export interface ServerInfo {
  name: string;
  state: ConnectionState;
  host: string;
  user: string;
  port: number;
  isDefault: boolean;
  isActive: boolean;
}

export class BifrostRegistry {
  private managers = new Map<string, BifrostManager>();
  private _activeServer: string | null = null;
  private _defaultServer: string | null = null;
  private _config: MultiServerConfig | null = null;
  private _discoveredKeys: string[] = [];

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

    if (this._config.keyDiscovery) {
      this._discoveredKeys = discoverSSHKeys();
    }

    for (const [name, serverConfig] of Object.entries(this._config.servers)) {
      this.register(name, serverConfig);
    }
  }

  private register(name: string, config: BifrostServerConfig): void {
    const manager = new BifrostManager();
    manager.setConfig(config);

    if (!config.keyPath && this._discoveredKeys.length > 0) {
      manager.setDiscoveredKeys(this._discoveredKeys);
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
