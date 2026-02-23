import { z } from "zod";
import { readFileSync, existsSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { isWindows } from "./paths";

const SAFE_HOST_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
const SAFE_USER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_\-]*$/;

export const BifrostServerSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(253)
    .refine(
      (h) => SAFE_HOST_PATTERN.test(h),
      { message: "Invalid host format. Use IP or hostname without special characters." }
    ),
  user: z
    .string()
    .default("root")
    .refine(
      (u) => SAFE_USER_PATTERN.test(u),
      { message: "Invalid username format" }
    ),
  keyPath: z
    .string()
    .optional(),
  keys: z
    .array(z.string())
    .optional(),
  port: z
    .number()
    .int()
    .positive()
    .default(22),
  connectTimeout: z
    .number()
    .int()
    .positive()
    .default(10),
  serverAliveInterval: z
    .number()
    .int()
    .positive()
    .default(30),
});

export type BifrostServerConfig = z.infer<typeof BifrostServerSchema>;

/** @deprecated Use BifrostServerSchema instead */
export const BifrostConfigSchema = BifrostServerSchema;
/** @deprecated Use BifrostServerConfig instead */
export type BifrostConfig = BifrostServerConfig;

const MultiServerRawSchema = z.object({
  servers: z.record(z.string(), z.union([BifrostServerSchema, z.string()])),
  default: z.string().optional(),
  keyDiscovery: z.boolean().default(true),
});

export interface MultiServerConfig {
  servers: Record<string, BifrostServerConfig>;
  defaultServer: string;
  keyDiscovery: boolean;
}

function expandTildePath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\") || filePath === "~") {
    const rest = filePath.slice(1).replace(/^[/\\]/, "");
    return rest ? join(homedir(), rest) : homedir();
  }
  return filePath;
}

function validateKeyFile(keyPath: string): void {
  const expandedPath = expandTildePath(keyPath);

  if (!existsSync(expandedPath)) {
    throw new Error(`Key file not found: ${expandedPath}`);
  }

  try {
    const stats = statSync(expandedPath);

    if (!stats.isFile()) {
      throw new Error(`Key path ${expandedPath} is not a regular file`);
    }

    if (!isWindows()) {
      const mode = stats.mode;

      if (mode & 0o004) {
        throw new Error(
          `Key file ${expandedPath} is world-readable. Fix with: chmod 600 ${expandedPath}`
        );
      }

      if (mode & 0o040) {
        throw new Error(
          `Key file ${expandedPath} is group-readable. Fix with: chmod 600 ${expandedPath}`
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Key")) {
      throw err;
    }
    throw new Error(`Failed to check key file permissions: ${err}`);
  }
}

export function parseServerShorthand(input: string): { host: string; user: string; port: number } {
  let user = "root";
  let host: string;
  let port = 22;

  let remainder = input;

  const atIndex = remainder.indexOf("@");
  if (atIndex !== -1) {
    user = remainder.slice(0, atIndex);
    remainder = remainder.slice(atIndex + 1);
  }

  const colonIndex = remainder.lastIndexOf(":");
  if (colonIndex !== -1) {
    const portStr = remainder.slice(colonIndex + 1);
    const parsedPort = Number(portStr);
    if (!Number.isNaN(parsedPort) && Number.isInteger(parsedPort) && parsedPort > 0) {
      port = parsedPort;
      remainder = remainder.slice(0, colonIndex);
    }
  }

  host = remainder;

  if (!SAFE_HOST_PATTERN.test(host)) {
    throw new Error(`Invalid host in shorthand "${input}": ${host}`);
  }
  if (!SAFE_USER_PATTERN.test(user)) {
    throw new Error(`Invalid user in shorthand "${input}": ${user}`);
  }

  return { host, user, port };
}

function resolveServerEntry(
  name: string,
  entry: z.infer<typeof BifrostServerSchema> | string,
): BifrostServerConfig {
  if (typeof entry === "string") {
    const parsed = parseServerShorthand(entry);
    return {
      host: parsed.host,
      user: parsed.user,
      port: parsed.port,
      connectTimeout: 10,
      serverAliveInterval: 30,
    };
  }

  const resolved = { ...entry };
  if (resolved.keyPath) {
    resolved.keyPath = expandTildePath(resolved.keyPath);
    validateKeyFile(resolved.keyPath);
  }

  if (resolved.keys) {
    resolved.keys = resolved.keys.map((k) => {
      const expanded = expandTildePath(k);
      validateKeyFile(expanded);
      return expanded;
    });
  }
  return resolved;
}

function isLegacyFormat(rawJson: unknown): rawJson is Record<string, unknown> {
  return (
    typeof rawJson === "object" &&
    rawJson !== null &&
    "host" in rawJson &&
    typeof (rawJson as Record<string, unknown>)["host"] === "string"
  );
}

function parseLegacyConfig(rawJson: Record<string, unknown>): MultiServerConfig {
  if (rawJson["keyPath"] && typeof rawJson["keyPath"] === "string") {
    rawJson["keyPath"] = expandTildePath(rawJson["keyPath"]);
  }

  const legacySchema = BifrostServerSchema.extend({
    keyPath: z.string(),
  });

  const config = legacySchema.parse(rawJson);
  validateKeyFile(config.keyPath);

  return {
    servers: { default: config },
    defaultServer: "default",
    keyDiscovery: false,
  };
}

function parseMultiServerConfig(rawJson: unknown): MultiServerConfig {
  const raw = MultiServerRawSchema.parse(rawJson);

  const servers: Record<string, BifrostServerConfig> = {};
  const serverNames = Object.keys(raw.servers);

  if (serverNames.length === 0) {
    throw new Error("Config must define at least one server in 'servers'");
  }

  for (const name of serverNames) {
    const entry = raw.servers[name];
    if (entry === undefined) continue;
    servers[name] = resolveServerEntry(name, entry);
  }

  const defaultServer = raw.default ?? serverNames[0];
  if (defaultServer === undefined) {
    throw new Error("Could not determine default server");
  }

  if (!(defaultServer in servers)) {
    throw new Error(`Default server "${defaultServer}" not found in servers`);
  }

  return {
    servers,
    defaultServer,
    keyDiscovery: raw.keyDiscovery,
  };
}

export function parseConfig(configPath: string): MultiServerConfig {
  try {
    if (!existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    const rawContent = readFileSync(configPath, "utf-8");
    const rawJson: unknown = JSON.parse(rawContent);

    if (isLegacyFormat(rawJson)) {
      return parseLegacyConfig(rawJson as Record<string, unknown>);
    }

    return parseMultiServerConfig(rawJson);
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === "ZodError") {
        const pathMatches = err.message.match(/"path":\s*\[\s*"([^"]+)"/g);
        if (pathMatches) {
          const fields = pathMatches
            .map((match) => {
              const fieldMatch = match.match(/"([^"]+)"$/);
              return fieldMatch ? fieldMatch[1] : null;
            })
            .filter((f) => f !== null) as string[];

          const uniqueFields = Array.from(new Set(fields));
          if (uniqueFields.length > 0) {
            throw new Error(`Missing required field(s): ${uniqueFields.join(", ")}`);
          }
        }

        throw new Error(`Invalid config: ${err.message}`);
      }

      if (
        err.message.startsWith("Key file") ||
        err.message.startsWith("Failed to check") ||
        err.message.startsWith("Config file not found") ||
        err.message.startsWith("Invalid host") ||
        err.message.startsWith("Invalid user") ||
        err.message.startsWith("Default server") ||
        err.message.startsWith("Config must define")
      ) {
        throw err;
      }

      if (err instanceof SyntaxError) {
        throw new Error(`JSON parse error: ${err.message}`);
      }
    }

    throw err;
  }
}
