import { existsSync, statSync } from "fs";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostRegistry } from "../registry";
import { validatePath } from "../security";

export const bifrost_upload: ToolDefinition = tool({
  description:
    "Upload a local file to the remote server via the persistent Bifrost connection.",
  args: {
    localPath: tool.schema
      .string()
      .describe("Local file path to upload"),
    remotePath: tool.schema
      .string()
      .describe("Remote file path destination"),
    server: tool.schema
      .string()
      .optional()
      .describe("Name of the server to upload to. If not specified, uses the active or default server."),
  },
  execute: async (args) => {
    try {
      const localValidation = validatePath(args.localPath, "localPath", { local: true });
      if (!localValidation.valid) {
        return `Error: ${localValidation.error}`;
      }

      const remoteValidation = validatePath(args.remotePath, "remotePath");
      if (!remoteValidation.valid) {
        return `Error: ${remoteValidation.error}`;
      }

      if (!existsSync(args.localPath)) {
        return `Error: Local file not found: ${args.localPath}`;
      }

      if (!bifrostRegistry.config) {
        bifrostRegistry.loadConfig();
      }

      const { name, manager } = await bifrostRegistry.connect(args.server);

      const stat = statSync(args.localPath);
      const fileSize = stat.size;

      await manager.upload(args.localPath, args.remotePath);

      const config = manager.config;
      if (!config) {
        return "Error: No config loaded";
      }

      const serverLabel = bifrostRegistry.serverCount > 1 ? ` [${name}]` : "";
      return `📤 Uploaded${serverLabel} ${args.localPath} → ${config.user}@${config.host}:${args.remotePath} (${fileSize} bytes)`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred during upload";
    }
  },
});
