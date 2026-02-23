import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostRegistry } from "../registry";
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

      if (!bifrostRegistry.config) {
        bifrostRegistry.loadConfig(configPath);
      }

      const servers = bifrostRegistry.listServers();

      if (servers.length === 0) {
        return "🌈 Bifrost Status\nNo servers configured";
      }

      let output = "🌈 Bifrost Status\n";

      for (const server of servers) {
        const flags: string[] = [];
        if (server.isDefault) flags.push("default");
        if (server.isActive) flags.push("active");
        const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";

        const stateIcon = server.state === "connected" ? "🟢" : "⚪";

        output += `\n${stateIcon} ${server.name}${flagStr}: ${server.user}@${server.host}:${server.port} [${server.state}]`;
      }

      const connected = bifrostRegistry.connectedCount;
      const total = servers.length;
      output += `\n\n${connected}/${total} connected`;

      return output;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred while checking status";
    }
  },
});
