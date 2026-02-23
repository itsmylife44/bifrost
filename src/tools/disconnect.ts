import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostRegistry } from "../registry";

export const bifrost_disconnect: ToolDefinition = tool({
  description:
    "Disconnect the Bifrost SSH connection and clean up resources.",
  args: {
    server: tool.schema
      .string()
      .optional()
      .describe("Name of the server to disconnect. If not specified, disconnects all servers."),
  },
  execute: async (args) => {
    try {
      if (bifrostRegistry.connectedCount === 0) {
        return "Not connected. Nothing to disconnect.";
      }

      await bifrostRegistry.disconnect(args.server);

      if (args.server) {
        return `🌈 Bifrost bridge to "${args.server}" closed.`;
      }

      return "🌈 All Bifrost bridges closed.";
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred during disconnect";
    }
  },
});
