import { statSync } from "fs";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostManager } from "../manager";
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
  },
  execute: async (args) => {
    try {
      const remoteValidation = validatePath(args.remotePath, "remotePath");
      if (!remoteValidation.valid) {
        return `Error: ${remoteValidation.error}`;
      }

      const localValidation = validatePath(args.localPath, "localPath");
      if (!localValidation.valid) {
        return `Error: ${localValidation.error}`;
      }

      await bifrostManager.ensureConnected();

      await bifrostManager.download(args.remotePath, args.localPath);

      // Get file size after download
      const stat = statSync(args.localPath);
      const fileSize = stat.size;

      // Get config for display
      const config = bifrostManager.config;
      if (!config) {
        return "Error: No config loaded";
      }

      return `📥 Downloaded ${config.user}@${config.host}:${args.remotePath} → ${args.localPath} (${fileSize} bytes)`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred during download";
    }
  },
});
