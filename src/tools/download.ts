import { statSync } from "fs";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostRegistry } from "../registry";
import { validatePath } from "../security";

export const bifrost_download: ToolDefinition = tool({
  description:
    "Download a file from the remote server to the local machine via the persistent Bifrost connection.",
  args: {
    remotePath: tool.schema
      .string()
      .describe("Remote file path to download"),
    localPath: tool.schema
      .string()
      .describe("Local file path destination"),
    server: tool.schema
      .string()
      .optional()
      .describe("Name of the server to download from. If not specified, uses the active or default server."),
  },
  execute: async (args) => {
    try {
      const remoteValidation = validatePath(args.remotePath, "remotePath");
      if (!remoteValidation.valid) {
        return `Error: ${remoteValidation.error}`;
      }

      const localValidation = validatePath(args.localPath, "localPath", { local: true });
      if (!localValidation.valid) {
        return `Error: ${localValidation.error}`;
      }

      if (!bifrostRegistry.config) {
        bifrostRegistry.loadConfig();
      }

      const { name, manager } = await bifrostRegistry.connect(args.server);

      await manager.download(args.remotePath, args.localPath);

      const stat = statSync(args.localPath);
      const fileSize = stat.size;

      const config = manager.config;
      if (!config) {
        return "Error: No config loaded";
      }

      const serverLabel = bifrostRegistry.serverCount > 1 ? ` [${name}]` : "";
      return `📥 Downloaded${serverLabel} ${config.user}@${config.host}:${args.remotePath} → ${args.localPath} (${fileSize} bytes)`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred during download";
    }
  },
});
