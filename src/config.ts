import { z } from "zod";
import { readFileSync, existsSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { isWindows } from "./paths";

const SAFE_HOST_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
const SAFE_USER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_\-]*$/;

export const BifrostConfigSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(253)
    .refine(
      (h) => SAFE_HOST_PATTERN.test(h),
      { message: "Invalid host format. Use IP or hostname without special characters." }
    )
    .describe("IP address or hostname of the remote server"),
  user: z
    .string()
    .default("root")
    .refine(
      (u) => SAFE_USER_PATTERN.test(u),
      { message: "Invalid username format" }
    )
    .describe("SSH username for authentication"),
  keyPath: z
    .string()
    .describe("Path to SSH private key (supports ~ expansion)"),
  port: z
    .number()
    .int()
    .positive()
    .default(22)
    .describe("SSH port number"),
  connectTimeout: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe("Connection timeout in seconds"),
  controlPersist: z
    .string()
    .default("15m")
    .describe("ControlPersist value for SSH multiplexing"),
  serverAliveInterval: z
    .number()
    .int()
    .positive()
    .default(30)
    .describe("Keepalive interval in seconds"),
});

export type BifrostConfig = z.infer<typeof BifrostConfigSchema>;

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

export function parseConfig(configPath: string): BifrostConfig {
  try {
    if (!existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    const rawContent = readFileSync(configPath, "utf-8");
    const rawJson = JSON.parse(rawContent);

    // Expand tilde in keyPath before validation
    if (rawJson.keyPath) {
      rawJson.keyPath = expandTildePath(rawJson.keyPath);
    }

    const config = BifrostConfigSchema.parse(rawJson);

    // Validate key file after schema parsing
    validateKeyFile(config.keyPath);

    return config;
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

      if (err.message.startsWith("Key file") || err.message.startsWith("Failed to check")) {
        throw err;
      }

      if (err instanceof SyntaxError) {
        throw new Error(`JSON parse error: ${err.message}`);
      }
    }

    throw err;
  }
}
