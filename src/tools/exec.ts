import { homedir } from "os";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { bifrostManager } from "../manager";
import { validatePath, validateCommand } from "../security";

export const bifrost_exec: ToolDefinition = tool({
  description:
    "Execute a command on the remote server via the persistent Bifrost SSH connection. Requires bifrost_connect to be called first (or auto-connects).",
  args: {
    command: tool.schema
      .string()
      .describe("The shell command to execute remotely"),
    cwd: tool.schema
      .string()
      .optional()
      .describe("Working directory on remote server"),
    timeout: tool.schema
      .number()
      .int()
      .default(30000)
      .describe("Command timeout in milliseconds (default: 30000)"),
  },
  execute: async (args) => {
    try {
      // Auto-ensure connected with config
      const configPath = `${homedir()}/.config/opencode/bifrost.json`;
      if (!bifrostManager.config) {
        bifrostManager.loadConfig(configPath);
      }

      await bifrostManager.ensureConnected();

      const cmdValidation = validateCommand(args.command);
      if (!cmdValidation.valid) {
        return `Error: ${cmdValidation.error}`;
      }

      let builtCommand = args.command;
      if (args.cwd) {
        const cwdValidation = validatePath(args.cwd, "cwd");
        if (!cwdValidation.valid) {
          return `Error: ${cwdValidation.error}`;
        }
        // Escape single quotes in cwd for safe shell usage
        const escapedCwd = args.cwd.replace(/'/g, "'\\''");
        builtCommand = `cd '${escapedCwd}' && ${args.command}`;
      }

      const result = await bifrostManager.exec(builtCommand, { 
        timeout: args.timeout,
        maxOutputBytes: 10 * 1024 * 1024,
      });

      let output = `📡 Remote exec: ${args.command}\nExit code: ${result.exitCode}\n\nstdout:\n${result.stdout}`;
      
      if (result.stderr) {
        output += `\n\nstderr:\n${result.stderr}`;
      }

      return output;
    } catch (error) {
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return "Error: Unknown error occurred during remote execution";
    }
  },
});
