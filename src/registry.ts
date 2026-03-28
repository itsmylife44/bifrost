import { BifrostManager, BifrostError } from "./manager";
import type { ConnectionState } from "./manager";
import type { BifrostServerConfig, MultiServerConfig } from "./config";
import { parseConfig, expandTildePathPublic } from "./config";
import { getSSHConfigKeysForHost } from "./keys";
import { getDefaultConfigPath, isWindows } from "./paths";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const WINDOWS_OPENSSH_AGENT_PIPE = "//./pipe/openssh-ssh-agent";

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

  // Normalize Windows pipe paths to forward slashes for ssh2 compatibility.
  // ssh2 interprets backslash paths as Cygwin unix sockets and fails.
  if (isWindowsPipe) {
    return envSock.replace(/\\/g, "/");
  }

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

function getWindowsOpenSshAdd(): string | null {
  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  const candidates = [
    join(systemRoot, "System32", "OpenSSH", "ssh-add.exe"),
    join(systemRoot, "Sysnative", "OpenSSH", "ssh-add.exe"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function trySshAdd(command: string, keyPath: string, env: NodeJS.ProcessEnv): boolean {
  execFileSync(command, [keyPath], {
    stdio: "ignore",
    timeout: 10_000,
    env,
  });
  return true;
}

function agentHasIdentitiesMessage(output: string): boolean {
  const normalized = output.toLowerCase();
  return !(normalized.includes("no identities") || normalized.includes("the agent has no identities"));
}

function trySshListIdentities(command: string, env: NodeJS.ProcessEnv): boolean {
  try {
    const output = execFileSync(command, ["-l"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
      env,
    }).toString();
    return agentHasIdentitiesMessage(output);
  } catch {
    return false;
  }
}

export function buildSshAddAttempts(
  windows: boolean,
  windowsOpenSshAdd: string | null,
  agentSocket: string | undefined,
  env: NodeJS.ProcessEnv
): Array<{ command: string; env: NodeJS.ProcessEnv; label: string }> {
  const attempts: Array<{ command: string; env: NodeJS.ProcessEnv; label: string }> = [];

  if (windows && windowsOpenSshAdd) {
    const openSshEnv = agentSocket ? { ...env, SSH_AUTH_SOCK: agentSocket } : env;
    attempts.push({
      command: windowsOpenSshAdd,
      env: openSshEnv,
      label: "windows-openssh",
    });
  }

  const normalizedEnv = agentSocket ? { ...env, SSH_AUTH_SOCK: agentSocket } : env;
  attempts.push({
    command: "ssh-add",
    env: normalizedEnv,
    label: "path-default",
  });

  return attempts;
}

export function shouldDowngradeSshAddFailure(
  windows: boolean,
  agentSocket: string | undefined,
  hasAgentIdentities: boolean
): boolean {
  return windows && Boolean(agentSocket) && hasAgentIdentities;
}

export interface KeyLoadNotice {
  level: "info" | "warn";
  message: string;
}

function ensureKeysInAgent(config: BifrostServerConfig): KeyLoadNotice[] {
  const notices: KeyLoadNotice[] = [];
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
  const windowsOpenSshAdd = windows ? getWindowsOpenSshAdd() : null;

  for (const keyPath of keyPaths) {
    const expanded = expandTildePathPublic(keyPath);
    const attempts = buildSshAddAttempts(windows, windowsOpenSshAdd, agentSocket, process.env);

    let success = false;
    let lastError: string | null = null;
    let lastLabel: string | null = null;

    for (const attempt of attempts) {
      try {
        if (trySshAdd(attempt.command, expanded, attempt.env)) {
          success = true;
          break;
        }
      } catch (error) {
        lastLabel = attempt.label;
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!success && lastError) {
      const hasAgentIdentities = attempts.some((attempt) =>
        trySshListIdentities(attempt.command, attempt.env)
      );

      if (shouldDowngradeSshAddFailure(windows, agentSocket, hasAgentIdentities)) {
        notices.push({
          level: "info",
          message: `Skipped ssh-add for key (${expanded}); agent already has identities loaded.`,
        });
        continue;
      }

      const platformHint = windows
        ? "Ensure Windows OpenSSH ssh-agent is running and prefer native ssh-add.exe from System32 OpenSSH."
        : "Ensure ssh-agent is running and ssh-add is available in PATH.";

      notices.push({
        level: "warn",
        message: `Failed to load SSH key (${expanded}) after ${attempts.length} attempt(s). Last: ${lastLabel}. ${platformHint} Error: ${lastError}`,
      });
    }
  }

  return notices;
}

function getConfiguredKeyPaths(config: BifrostServerConfig): string[] {
  const keyPaths: string[] = [];

  if (config.keyPath) keyPaths.push(config.keyPath);
  if (config.keys && config.keys.length > 0) keyPaths.push(...config.keys);
  if (keyPaths.length === 0) keyPaths.push(...getSSHConfigKeysForHost(config.host));

  return Array.from(new Set(keyPaths.map((keyPath) => expandTildePathPublic(keyPath))));
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
    manager.setAllowedKeyPaths(getConfiguredKeyPaths(config));

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

  async connect(serverName?: string): Promise<{ name: string; manager: BifrostManager; notices: KeyLoadNotice[] }> {
    const name = this.resolveName(serverName);
    const config = this._config?.servers[name];

    const notices = config ? ensureKeysInAgent(config) : [];

    const manager = this.getManager(name);
    await manager.ensureConnected();
    this._activeServer = name;

    return { name, manager, notices };
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
