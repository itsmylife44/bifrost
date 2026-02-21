import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostManager } from "../manager";
import { existsSync } from "fs";
import { getDefaultConfigPath } from "../paths";

export const bifrost_status: ToolDefinition = tool({
  description:
    "Check the status of the Bifrost SSH connection. Shows whether connected, server details, and connection health.",
  args: {},
  execute: async () => {
    try {
      const configPath = getDefaultConfigPath();

      if (!existsSync(configPath)) {
        return `🌈 Bifrost Status\nState: Disconnected\nError: No configuration found at ${configPath}`;
      }

      if (!bifrostManager.config) {
        bifrostManager.loadConfig(configPath);
      }

      const connected = await bifrostManager.isConnected();
      const config = bifrostManager.config;

      if (!config) {
        return `🌈 Bifrost Status\nState: Disconnected\nError: Failed to load configuration`;
      }

      const state = connected ? "Connected" : "Disconnected";
      const server = `${config.user}@${config.host}:${config.port}`;

      let output = `🌈 Bifrost Status\nState: ${state}\nServer: ${server}`;

      if (connected) {
        output += "\nHealth: Connection alive";
      }

      return output;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred while checking status";
    }
  },
});
