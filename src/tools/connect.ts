import { homedir } from "os";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostManager } from "../manager";

export const bifrost_connect: ToolDefinition = tool({
  description:
    "Establish a persistent SSH connection to the configured remote server. Uses SSH ControlMaster multiplexing. Once connected, use bifrost_exec to run commands.",
  args: {
    configPath: tool.schema
      .string()
      .optional()
      .describe("Path to bifrost config file (defaults to ~/.config/opencode/bifrost.json)"),
  },
  execute: async (args) => {
    try {
      const configPath = args.configPath || `${homedir()}/.config/opencode/bifrost.json`;
      bifrostManager.loadConfig(configPath);

      if (bifrostManager.state === "connected") {
        const config = bifrostManager.config;
        return `Already connected to ${config?.user}@${config?.host}`;
      }

      await bifrostManager.connect();

      const config = bifrostManager.config;
      return `🌈 Bifrost bridge established to ${config?.user}@${config?.host}:${config?.port}\nConnection persistent. Use bifrost_exec to run commands.`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred while connecting";
    }
  },
});
