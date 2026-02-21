import { homedir, platform } from "os";
import { join } from "path";

const IS_WINDOWS = platform() === "win32";

export function getConfigDir(): string {
  const xdgConfig = process.env["XDG_CONFIG_HOME"];
  if (xdgConfig) {
    return join(xdgConfig, "opencode");
  }

  return join(homedir(), ".config", "opencode");
}

export function getDefaultConfigPath(): string {
  return join(getConfigDir(), "bifrost.json");
}

export function isWindows(): boolean {
  return IS_WINDOWS;
}
