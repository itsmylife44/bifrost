import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostManager } from "../manager";

export const bifrost_disconnect: ToolDefinition = tool({
  description:
    "Disconnect the Bifrost SSH connection and clean up the control socket.",
  args: {},
  execute: async () => {
    try {
      // Check if connected
      if (bifrostManager.state === "disconnected") {
        return "Not connected. Nothing to disconnect.";
      }

      // Disconnect
      await bifrostManager.disconnect();

      // Get user and host for message
      const config = bifrostManager.config;
      const userHost = config ? `${config.user}@${config.host}` : "remote server";

      return `🌈 Bifrost bridge closed. Connection to ${userHost} terminated.`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred during disconnect";
    }
  },
});
