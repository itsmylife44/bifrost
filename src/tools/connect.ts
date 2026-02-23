import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostRegistry } from "../registry";

export const bifrost_connect: ToolDefinition = tool({
  description:
    "Establish a persistent SSH connection to the configured remote server. Uses SSH ControlMaster multiplexing. Once connected, use bifrost_exec to run commands. Works cross-platform (macOS, Linux, Windows).",
  args: {
    configPath: tool.schema
      .string()
      .optional()
      .describe("Path to bifrost config file. DO NOT set this — it is auto-detected from ~/.config/opencode/bifrost.json. Only override if the user explicitly provides a custom path."),
    server: tool.schema
      .string()
      .optional()
      .describe("Name of the server to connect to. If not specified, connects to the default server."),
  },
  execute: async (args) => {
    try {
      if (!bifrostRegistry.config) {
        bifrostRegistry.loadConfig(args.configPath);
      }

      const { name, manager } = await bifrostRegistry.connect(args.server);
      const config = manager.config;

      return `🌈 Bifrost bridge established to ${config?.user}@${config?.host}:${config?.port} (${name})\nConnection persistent. Use bifrost_exec to run commands.`;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred while connecting";
    }
  },
});
