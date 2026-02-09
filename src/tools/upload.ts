import { existsSync, statSync } from "fs";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostManager } from "../manager";
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
  },
  execute: async (args) => {
    try {
      const localValidation = validatePath(args.localPath, "localPath");
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

      await bifrostManager.ensureConnected();

      // Get file size before upload
      const stat = statSync(args.localPath);
      const fileSize = stat.size;

      // Upload
      await bifrostManager.upload(args.localPath, args.remotePath);

      // Get config for display
      const config = bifrostManager.config;
      if (!config) {
        return "Error: No config loaded";
      }

      return `📤 Uploaded ${args.localPath} → ${config.user}@${config.host}:${args.remotePath} (${fileSize} bytes)`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred during upload";
    }
  },
});
